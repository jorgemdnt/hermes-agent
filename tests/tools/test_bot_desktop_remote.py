"""Remote CDP is fenced only for the opted-in profile and its forwarded endpoint."""
from pathlib import Path

from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from tools.bot_desktop import lease, remote
from tools.browser_tool_session import run_fenced


def test_remote_cdp_fence_is_profile_scoped(tmp_path: Path):
    homes = [tmp_path / "a", tmp_path / "b"]
    for home in homes:
        home.mkdir()
    (homes[0] / "config.yaml").write_text(
        "bot_desktop:\n  remote_ssh:\n    host: 100.92.180.34\n    user: hermes\n"
        "    source_dir: /home/hermes/hermes-agent\n    cdp_local_port: 19222\n",
        encoding="utf-8",
    )
    session = {"features": {"cdp_override": True},
               "cdp_url": "ws://127.0.0.1:19222/devtools/browser/abc"}
    unrelated = {**session, "cdp_url": "ws://127.0.0.1:19223/devtools/browser/abc"}
    try:
        for home, shared in [(homes[0], True), (homes[1], False), (homes[0], True)]:
            token = set_hermes_home_override(home)
            try:
                assert remote.is_shared_cdp(session) is shared
                assert remote.is_shared_cdp(unrelated) is False
                lease.acquire("human-viewer")
                result = run_fenced(session, lambda: {"success": True})
                if shared:
                    assert result["code"] == "human_has_control"
                else:
                    assert result == {"success": True}
            finally:
                reset_hermes_home_override(token)
    finally:
        for home in homes:
            token = set_hermes_home_override(home)
            try:
                lease.release("human-viewer")
            finally:
                reset_hermes_home_override(token)
