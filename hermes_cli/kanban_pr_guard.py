"""Run-owned publication evidence and live GitHub state for duplicate-PR protection."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass

from hermes_cli import kanban_pr_acceptance as github


@dataclass(frozen=True)
class Publication:
    url: str
    run_id: int
    published_at: int


def _publications(conn, task_id: str) -> list[Publication]:
    from hermes_cli import kanban_db as kb

    publications = []
    for run in conn.execute(
        "SELECT id, metadata, started_at, ended_at FROM task_runs WHERE task_id = ?",
        (task_id,),
    ):
        url = kb._json_dict(run["metadata"]).get("published_pr")
        if isinstance(url, str) and github._PR.fullmatch(url):
            publications.append(Publication(url, run["id"], run["ended_at"] or run["started_at"]))

    # Comment IDs bind the exact text to a validated claim, without guessing
    # from author strings or attributing operator notes to the current worker.
    comments = {row["id"]: row for row in conn.execute(
        "SELECT id, body, created_at FROM task_comments WHERE task_id = ?", (task_id,),
    )}
    for event in conn.execute(
        "SELECT e.run_id, e.payload FROM task_events e "
        "JOIN task_runs r ON r.id = e.run_id AND r.task_id = e.task_id "
        "WHERE e.task_id = ? AND e.kind = 'commented'", (task_id,),
    ):
        comment_id = kb._json_dict(event["payload"]).get("comment_id")
        comment = comments.get(comment_id) if isinstance(comment_id, int) else None
        if comment is not None:
            for match in github._PR.finditer(kb._lossy_text(comment["body"])):
                publications.append(Publication(match[0], event["run_id"], comment["created_at"]))
    return sorted(publications, key=lambda p: (p.published_at, p.run_id), reverse=True)


@dataclass(frozen=True)
class Guard:
    reason: str
    publication: Publication
    read_error: str | None = None


def _describe_read_error(exc: BaseException) -> str:
    # Never persist gh stderr, response bodies or arbitrary exception text.
    if isinstance(exc, github._GateAuthError):
        return str(exc)
    if isinstance(exc, FileNotFoundError):
        return "gh executable not found on the service PATH or in known installation directories."
    if isinstance(exc, subprocess.TimeoutExpired):
        return f"gh api timed out after {exc.timeout} seconds."
    if isinstance(exc, subprocess.CalledProcessError):
        return f"gh api exited with status {exc.returncode}."
    if isinstance(exc, OSError):
        return f"gh api could not start (OS error {exc.errno})."
    return f"GitHub returned incomplete or invalid PR state ({type(exc).__name__})."


def published_pr_guard(conn, task_id: str) -> Guard | None:
    from hermes_cli.kanban_db_dispatch import _is_handoff_event

    seen = set()
    for publication in _publications(conn, task_id):
        events = conn.execute(
            "SELECT kind, payload FROM task_events WHERE task_id = ? AND created_at > ? "
            "AND kind IN ('assigned', 'changes_requested', 'review_reopened')",
            (task_id, publication.published_at),
        )
        if any(_is_handoff_event(e["kind"], e["payload"]) for e in events):
            continue
        if publication.url in seen:
            continue
        seen.add(publication.url)
        match = github._PR.fullmatch(publication.url)
        assert match is not None  # _publications only yields validated URLs.
        assignee = conn.execute("SELECT assignee FROM tasks WHERE id = ?", (task_id,)).fetchone()["assignee"]
        try:
            state = github._api(f"repos/{match[1]}/pulls/{match[2]}",
                                profile_home=github._assignee_profile_home(assignee))
            if state["state"] == "closed" or state.get("merged"):
                continue
            if state["state"] != "open":
                raise ValueError("Unknown PR state")
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, github._GateAuthError) as exc:
            # A failed state read is not proof the published PR went away.
            return Guard("pr_state_unavailable", publication, _describe_read_error(exc))
        return Guard("active_pr", publication)
    return None


def record_guard(conn, task_id: str, reason: str, *, pr_url: str | None = None,
                 run_id: int | None = None, read_error: str | None = None) -> None:
    from hermes_cli import kanban_db as kb

    payload = {"reason": reason}
    if pr_url is not None:
        payload["pr_url"] = pr_url
    with kb.write_txn(conn):
        last = conn.execute(
            "SELECT payload, run_id FROM task_events WHERE task_id = ? AND kind = 'guarded' "
            "ORDER BY id DESC LIMIT 1", (task_id,),
        ).fetchone()
        if last is None or kb._json_dict(last["payload"]) != payload or last["run_id"] != run_id:
            kb._append_event(conn, task_id, "guarded", payload, run_id=run_id)
        if reason == "pr_state_unavailable" and pr_url and read_error:
            body = (f"Dispatcher is holding this card to avoid a duplicate of [Published pull request]({pr_url}).\n"
                    f"GitHub state read failed: {read_error}\n"
                    "Check gh installation and the assignee profile's GitHub credentials/API access. "
                    "The dispatcher will retry the state read automatically.")
            if not conn.execute(
                "SELECT 1 FROM task_comments WHERE task_id = ? AND author = 'dispatcher' AND body = ?",
                (task_id, body),
            ).fetchone():
                # Task-scoped: a dispatcher notice is not worker publication evidence.
                kb.add_comment(conn, task_id, author="dispatcher", body=body)
