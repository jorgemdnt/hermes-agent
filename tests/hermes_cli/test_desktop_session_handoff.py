"""Desktop session handoff: one visible session, no credential in the result."""

from types import SimpleNamespace

import pytest

from hermes_cli.desktop_session_handoff import (
    DesktopServe,
    find_desktop_serve,
    listening_port,
    public_result,
    run_handoff,
    session_link,
)


class _Proc:
    def __init__(self, env, connections):
        self._env = env
        self._connections = connections

    def environ(self):
        return self._env

    def net_connections(self, kind="tcp"):
        return self._connections


def _listen(port):
    return SimpleNamespace(status="LISTEN", laddr=SimpleNamespace(ip="127.0.0.1", port=port))


def test_listening_port_ignores_non_loopback():
    conns = [
        SimpleNamespace(status="LISTEN", laddr=SimpleNamespace(ip="0.0.0.0", port=9)),
        _listen(58844),
    ]
    assert listening_port(conns) == 58844


def test_find_desktop_serve_matches_home_not_argv():
    home = "/tmp/hermes-home"
    good = _Proc(
        {
            "HERMES_DESKTOP": "1",
            "HERMES_DASHBOARD_SESSION_TOKEN": "secret-token",
            "HERMES_HOME": home,
        },
        [_listen(58844)],
    )
    other_home = _Proc(
        {
            "HERMES_DESKTOP": "1",
            "HERMES_DASHBOARD_SESSION_TOKEN": "other",
            "HERMES_HOME": "/tmp/other",
        },
        [_listen(1)],
    )
    found = find_desktop_serve([other_home, good], home=home)
    assert found == DesktopServe(port=58844, token="secret-token")


def test_find_desktop_serve_refuses_two_matches():
    home = "/tmp/hermes-home"
    env = {
        "HERMES_DESKTOP": "1",
        "HERMES_DASHBOARD_SESSION_TOKEN": "secret-token",
        "HERMES_HOME": home,
    }
    procs = [_Proc(env, [_listen(1)]), _Proc(env, [_listen(2)])]
    assert find_desktop_serve(procs, home=home) is None


def test_run_handoff_submits_to_the_created_session_and_hides_the_token():
    serve = DesktopServe(port=9, token="secret-token")
    calls = []

    def rpc(_serve, method, params):
        calls.append((method, params))
        assert _serve.token == "secret-token"
        if method == "session.create":
            return {"result": {"session_id": "runtime", "stored_session_id": "stored"}}
        return {"result": {"ok": True}}

    result = run_handoff(
        serve, title="Allow", prompt="fix it", cwd="/repo", resume=None, rpc=rpc,
        profile="default",
    )
    assert calls[0][0] == "session.create"
    assert calls[0][1]["hidden"] is False
    assert calls[0][1]["source"] == "desktop"
    submitted = calls[1][1]
    assert calls[1][0] == "prompt.submit"
    assert submitted["session_id"] == "runtime"
    assert submitted["title_preview"] == "Allow"
    assert "Do not call `hermes sessions handoff`" in submitted["text"]
    assert submitted["text"].endswith("fix it")
    printed = public_result(result)
    assert "secret-token" not in printed
    assert result["link"] == "@session:default/stored"
    assert result["link"] in printed


def test_public_result_refuses_a_token_field():
    with pytest.raises(Exception):
        public_result({"token": "nope"})


def test_session_link_matches_the_desktop_chip_and_drops_custom():
    assert session_link("20260923_173420_b1fb25", "default") == "@session:default/20260923_173420_b1fb25"
    assert session_link("abc", "custom") == "@session:abc"
    assert session_link("abc", "") == "@session:abc"
