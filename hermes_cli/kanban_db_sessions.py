"""Durable worker transcript pointers and deliberately conservative legacy recovery."""
from __future__ import annotations

import contextlib
import logging
import os
import re
import sqlite3
import time
from collections import Counter, defaultdict
from pathlib import Path

logger = logging.getLogger(__name__)


def link_run_session(
    conn: sqlite3.Connection, task_id: str, run_id: int, session_id: str, *, claim_lock: str,
) -> bool:
    """Pin the first transcript to the exact live claim; never follow a replaced run."""
    from hermes_cli.kanban_db_connect import write_txn

    if not session_id or not claim_lock:
        return False
    with write_txn(conn):
        return conn.execute(
            "UPDATE task_runs SET session_id = ? "
            "WHERE id = ? AND task_id = ? AND status = 'running' AND ended_at IS NULL "
            "AND claim_lock = ? AND profile IS NOT NULL "
            "AND (session_id IS NULL OR session_id = ?) "
            "AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_runs.task_id "
            "            AND t.current_run_id = task_runs.id AND t.status = 'running' "
            "            AND t.claim_lock = ?) "
            "AND NOT EXISTS (SELECT 1 FROM task_runs other WHERE other.id != task_runs.id "
            "                AND other.profile = task_runs.profile AND other.session_id = ?)",
            (session_id, run_id, task_id, claim_lock, session_id, claim_lock, session_id),
        ).rowcount == 1


def record_worker_session(session_id: str, *, parent_session_id: str | None = None) -> bool:
    """Called only after the real session row exists, not when the dispatcher spawns.

    Compression/delegation children must not replace the initial transcript pointer.
    A busy board is retried at the next session ensure; missing pins never create a board.
    """
    from agent.delegation_context import is_dispatcher_owned_worker_context

    if parent_session_id or not is_dispatcher_owned_worker_context():
        return False
    task_id = os.environ.get("HERMES_KANBAN_TASK", "")
    raw_run_id = os.environ.get("HERMES_KANBAN_RUN_ID", "")
    db_path = os.environ.get("HERMES_KANBAN_DB", "")
    claim_lock = os.environ.get("HERMES_KANBAN_CLAIM_LOCK", "")
    if not (task_id and db_path and claim_lock and re.fullmatch(r"[1-9][0-9]*", raw_run_id)):
        return False
    try:
        from hermes_cli.kanban_db_connect import connect_closing

        path = Path(db_path)
        if not path.is_file():
            return False
        with connect_closing(path) as conn:
            return link_run_session(conn, task_id, int(raw_run_id), session_id, claim_lock=claim_lock)
    except (sqlite3.Error, OSError, ValueError) as exc:
        logger.warning("Kanban run %s session link failed (will retry): %s", raw_run_id, exc)
        return False


def _profile_sessions(profile: str, title_start: dict[str, int]) -> dict[str, list[dict]]:
    from hermes_constants import get_default_hermes_root, get_hermes_home

    # Do not turn a malformed or remote assignee into a local directory, nor fall
    # back to the active profile when the recorded assignee's state is unavailable.
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", profile):
        return {}
    root = get_default_hermes_root(home=get_hermes_home())
    home = root if profile == "default" else root / "profiles" / profile
    path = home / "state.db"
    if not path.is_file():
        return {}
    result: dict[str, list[dict]] = defaultdict(list)
    try:
        # SessionDB opens/migrates writable state; this recovery must be a pure
        # reader of the assignee's store, including when it is old or on a VPS.
        with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as state:
            state.row_factory = sqlite3.Row
            for row in state.execute(
                "SELECT id, title, started_at FROM sessions WHERE source = 'kanban' "
                "AND parent_session_id IS NULL AND started_at >= ?",
                (min(title_start.values()),),
            ):
                for title in title_start:
                    # The canonical title store adds #N on retry/collision. Keep
                    # the source/time/one-to-one fences; do not fuzzy-match prose.
                    base = re.sub(r" #[0-9]+$", "", title)
                    if row["title"] == title or re.fullmatch(re.escape(base) + r" #[1-9][0-9]*", row["title"] or ""):
                        result[title].append(dict(row))
    except (sqlite3.Error, OSError) as exc:
        logger.debug("Kanban session backfill skipped profile %s: %s", profile, exc)
        return {}
    return result


def backfill_run_sessions(conn: sqlite3.Connection, *, task_id: str | None = None) -> int:
    """Recover only a one-to-one source/title/time match in the run's own profile.

    Run timestamps are integer seconds, so the terminal second is included.
    Canonical card titles (including the store's retry suffix): edited titles and
    missing/ambiguous evidence stay NULL. All runs participate in ambiguity detection even when
    the caller asks to repair just one card. Existing links are never replaced.
    """
    from hermes_cli.kanban_db_connect import write_txn
    from agent.title_generator import kanban_session_title

    with write_txn(conn):
        rows = [dict(row) for row in conn.execute(
            "SELECT r.id, r.task_id, r.profile, r.status, r.started_at, r.ended_at, "
            "r.session_id, t.title FROM task_runs r JOIN tasks t ON t.id = r.task_id"
        ).fetchall()]
        for row in rows:
            row["title"] = kanban_session_title(row["title"])
        pending = [r for r in rows if r["session_id"] is None and (task_id is None or r["task_id"] == task_id)]
        if not pending:
            return 0
        by_profile: dict[str, list] = defaultdict(list)
        reserved = {(r["profile"], r["session_id"]) for r in rows if r["session_id"] is not None}
        for row in rows:
            if row["profile"] and row["title"]:
                by_profile[row["profile"]].append(row)
        candidates: dict[int, list[tuple[str, str]]] = {}
        now = time.time()
        for profile, runs in by_profile.items():
            title_start: dict[str, int] = {}
            for run in runs:
                title = run["title"]
                started = run["started_at"]
                if title not in title_start or started < title_start[title]:
                    title_start[title] = started
            sessions = _profile_sessions(profile, title_start)
            for run in runs:
                if run["ended_at"] is None and run["status"] != "running":
                    continue
                end = run["ended_at"] + 1 if run["ended_at"] is not None else now
                candidates[run["id"]] = [
                    (profile, s["id"]) for s in sessions.get(run["title"], [])
                    if run["started_at"] <= s["started_at"] < end
                ]
        owners = Counter(candidate for matches in candidates.values() for candidate in matches)
        updated = 0
        for run in pending:
            matches = candidates.get(run["id"], [])
            if len(matches) != 1:
                continue
            candidate = matches[0]
            if owners[candidate] != 1 or candidate in reserved:
                continue
            updated += conn.execute(
                "UPDATE task_runs SET session_id = ? WHERE id = ? AND session_id IS NULL",
                (candidate[1], run["id"]),
            ).rowcount
            reserved.add(candidate)
        return updated
