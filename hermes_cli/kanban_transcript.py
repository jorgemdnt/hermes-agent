"""Read-only card transcript snapshots; never attach to or resume a worker."""
from hermes_constants import get_default_hermes_root, get_hermes_home
from hermes_state import SessionDB
from tui_gateway import server


def run_transcript(run, *, limit: int = 100, offset: int = 0) -> dict:
    from hermes_cli.profiles import normalize_profile_name
    from hermes_yaml import safe_load

    profile = normalize_profile_name(run.profile or "default")
    root = get_default_hermes_root(home=get_hermes_home())
    home = root if profile == "default" else root / "profiles" / profile
    remote = False
    config_path = home / "config.yaml"
    if config_path.is_file():
        config = safe_load(config_path.read_text()) or {}
        remote = (config.get("terminal") or {}).get("backend") == "ssh"
    result = {"run_id": run.id, "session_id": run.session_id, "profile": profile,
              "running": run.status == "running" and run.ended_at is None,
              "location": "vps" if remote else "local", "messages": [], "has_more": False,
              "offset": offset, "returned": 0}
    if not run.session_id:
        result["unavailable"] = "Worker session has not been linked yet."
        return result
    path = home / "state.db"
    if not path.is_file():
        result["unavailable"] = "Transcript on VPS" if remote else "Session store is unavailable."
        return result
    # A direct read-only SessionDB, not the dashboard's schema-healing opener.
    # No live-session registry, agent build, lease claim, auto-continue or detach.
    with SessionDB(path, read_only=True) as db:
        if not db.get_session(run.session_id):
            result["unavailable"] = "Transcript on VPS" if remote else "Worker session is unavailable."
            return result
        tip = db.get_compression_tip(run.session_id) or run.session_id
        rows = db.get_messages(tip, include_ancestors=True, include_compacted=True,
                               latest=True, limit=limit + 1, offset=offset)
        result["has_more"] = len(rows) > limit
        rows = rows[-limit:]
        for row in rows:
            row["_row_id"] = row["id"]
        messages = server._history_to_messages(rows, profile_home=home, image_urls=False)
        tool_rows = {row.get("tool_call_id"): row["id"] for row in rows if row["role"] == "tool"}
        for message in messages:
            if message["role"] == "tool" and message.get("tool_call_id") in tool_rows:
                message["row_id"] = tool_rows[message["tool_call_id"]]
        result.update(location="local", returned=len(rows), messages=messages)
    return result
