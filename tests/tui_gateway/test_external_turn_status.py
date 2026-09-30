"""A real separate CLI writer must not look interrupted to a resumed viewer."""
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from hermes_state import SessionDB
from tui_gateway import server


def test_cli_turn_resume_tracks_owner_death_and_profile_isolation(tmp_path, monkeypatch):
    root = tmp_path / "hermes-root"  # not the child's native ~/.hermes (live-DB guard)
    home = root / "profiles" / "probe"
    home.mkdir(parents=True)
    requested, release = threading.Event(), threading.Event()

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            # Auxiliary startup probes must not masquerade as the actual turn.
            if b"run the probe" in body:
                requested.set()
                release.wait(60)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            try:
                self.wfile.write(json.dumps({"id": "probe", "object": "chat.completion", "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": "done"}, "finish_reason": "stop"}
                ]}).encode())
            except BrokenPipeError:
                pass

    provider = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    thread = threading.Thread(target=provider.serve_forever, daemon=True)
    thread.start()
    from hermes_cli.config import atomic_config_write
    atomic_config_write(home / "config.yaml", {
        "model": {"default": "probe", "provider": "custom", "base_url": f"http://127.0.0.1:{provider.server_port}/v1"},
        "terminal": {"cwd": str(tmp_path)},
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "session": {"auto_title": False},
    })
    db = SessionDB(home / "state.db")
    db.create_session("probe-session", source="cli")
    db.set_session_title("probe-session", "Bot Chat")
    launch_db = SessionDB(root / "state.db")
    launch_db.create_session("probe-session", source="cli")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(server, "_get_db", lambda: launch_db)
    monkeypatch.setattr(server, "_start_agent_build", lambda *args: None)
    monkeypatch.setattr(server, "_enable_gateway_prompts", lambda: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda: None)
    monkeypatch.setattr(server, "_emit", lambda *args: None)
    env = {key: value for key, value in os.environ.items()
           if not (key.endswith("_TOKEN") or key.endswith("_API_KEY") or key.startswith("HERMES_KANBAN"))}
    env.update(HOME=str(tmp_path), HERMES_HOME=str(root), OPENAI_API_KEY="local-test-only",
               PYTHONPATH=str(Path(__file__).resolve().parents[2]), HERMES_PM_BOOTSTRAP="0")
    child = subprocess.Popen([sys.executable, "-m", "hermes_cli.main", "-p", "probe", "chat",
                              "-c", "Bot Chat", "-Q", "-q", "Message from Frodo (@hermes): run the probe"],
                             cwd=tmp_path, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    runtime_ids = []

    def resume(profile):
        response = server.handle_request({"id": "probe", "method": "session.resume", "params": {
            "profile": profile, "session_id": "probe-session", "source": "mobile",
            "defer_history": True, "omit_messages": True,
        }})
        assert response and "error" not in response, response
        result = response["result"]
        runtime_ids.append(result["session_id"])
        return result

    try:
        deadline = time.monotonic() + 40
        while not requested.wait(0.1):
            if child.poll() is not None or time.monotonic() > deadline:
                child.kill()
                out, err = child.communicate()
                raise AssertionError(f"CLI never reached local provider: {out}\n{err}")
        first = resume("probe")
        assert first["running"] and first["external_turn"], (first, db.get_session_turn_lease("probe-session"))
        assert not server._sessions[first["session_id"]]["running"]  # viewer is not a second writer
        assert not resume("default")["running"]  # same id in another store is unrelated
        assert resume("probe")["external_turn"]  # A -> B -> A
        child.kill()
        child.communicate(timeout=10)
        ended = resume("probe")
        assert not ended["running"] and not ended["external_turn"]
        assert db.get_session_turn_lease("probe-session") is None  # not five minutes of ghost status
    finally:
        if child.poll() is None:
            child.kill()
            child.communicate(timeout=10)
        release.set()
        provider.shutdown()
        provider.server_close()
        for sid in set(runtime_ids):
            record = server._sessions.pop(sid, None)
            if record and record.get("resume_history_ready"):
                record["resume_history_ready"].wait(5)
        db.close()
        launch_db.close()


def test_turn_owner_follows_compression_but_not_explicit_forks(tmp_path):
    db = SessionDB(tmp_path / "state.db")
    try:
        db.create_session("parent", source="cli")
        db.end_session("parent", "compression")
        db.create_session("tip", source="cli", parent_session_id="parent")
        db.create_session("fork", source="cli", parent_session_id="parent",
                          model_config={"_branched_from": "parent"})
        holder = f"pid={os.getpid()}:turn=probe:platform=cli"
        assert db.try_acquire_session_turn_lease("tip", holder)
        assert db.get_session_turn_lease("parent") == db.get_session_turn_lease("tip")
        assert db.get_session_turn_lease("fork") is None
        db.release_session_turn_lease("tip", holder)
        assert db.get_session_turn_lease("parent") is None
    finally:
        db.close()
