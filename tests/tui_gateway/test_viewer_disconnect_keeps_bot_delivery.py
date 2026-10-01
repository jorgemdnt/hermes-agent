"""A bounded cross-bot reply runner outlives its sender's viewer runtime."""

import json
import shlex
import sys
import threading
import time

import pytest

from tools import bot_mode_dm, process_registry as process_module, terminal_tool
from tools.environments import local
from tui_gateway import server
from hermes_state import SessionDB
from run_agent import AIAgent


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("stop", [False, True])
def test_sender_disconnect_does_not_terminate_recipient_turn(tmp_path, monkeypatch, stop, caplog):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(local, "_resolve_hermes_bin_dir", lambda: None)
    # Use the real registry/reader, but no login shell or user service scope.
    registry = process_module.ProcessRegistry()
    monkeypatch.setattr(registry, "_scope_argv", lambda _session, command, *_: ["/bin/sh", "-c", command])
    monkeypatch.setattr(process_module, "process_registry", registry)
    spawned = []

    def spawn(command, **kwargs):
        process = registry.spawn_local(command, task_id=kwargs["task_id"],
                                       persist_on_release=kwargs.get("persist_on_release", False))
        spawned.append(process)
        return json.dumps({"session_id": process.id})

    monkeypatch.setattr(terminal_tool, "terminal_tool", spawn)
    key = "sender-bot-chat"
    db = SessionDB(db_path=home / "state.db")
    db.create_session(key, source="desktop")
    agent = AIAgent.__new__(AIAgent)
    agent.session_id = key
    agent._session_db = db
    agent._owns_session_db = True
    agent._end_session_on_close = True
    agent._session_messages = []
    agent._process_owner_task_ids = {key}
    agent._active_children_lock = threading.Lock()
    agent._active_children = []
    agent._memory_manager = None
    transport = object()
    session = dict(agent=agent, history=[], history_lock=threading.RLock(), session_key=key,
                   profile_home=str(home), source="desktop", transport=transport,
                   close_on_disconnect=True, running=False)
    monkeypatch.setattr(server, "_sessions", {"viewer": session})
    # The real recipient turn is represented by a separate OS process, blocked
    # mid-tool until teardown has run. No model/provider is constructed.
    ready, release = tmp_path / "ready", tmp_path / "release"
    child = tmp_path / "recipient.py"
    child.write_text(
        "from pathlib import Path\nimport sys, time\n"
        "ready, release = map(Path, sys.argv[1:])\nready.touch()\n"
        "deadline = time.monotonic() + 20\n"
        "while not release.exists():\n"
        "    if time.monotonic() > deadline: raise TimeoutError('fixture not released')\n"
        "    time.sleep(0.01)\n"
        "print('recipient final reply', flush=True)\n", encoding="utf-8")
    command = shlex.join([sys.executable, str(child), str(ready), str(release)])
    try:
        result = json.loads(bot_mode_dm._spawn_delivery(command, "@recipient", task_id=key, agent=None))
        assert result["status"] == "queued"
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert ready.exists(), "recipient never reached its in-flight tool"
        process = spawned[0]
        server._rebind_live_transport("viewer", session, transport)
        with caplog.at_level("INFO"):
            assert server._close_sessions_for_transport(transport) == (1, 0)
        assert process.process.poll() is None, "viewer cleanup killed the recipient's DM turn"
        if stop:
            assert registry.kill_all(key, source="process.kill") == 1
            assert process.process.wait(timeout=10) != 0
        else:
            release.touch()
            assert process.process.wait(timeout=10) == 0
            deadline = time.monotonic() + 10
            while "recipient final reply" not in process.output_buffer and time.monotonic() < deadline:
                time.sleep(0.01)
            assert "recipient final reply" in process.output_buffer
        assert "end_reason=ws_disconnect" in caplog.text
        assert key in caplog.text
    finally:
        release.touch()
        for process in spawned:
            registry.kill_process(process.id, source="process.kill")
        db.close()
