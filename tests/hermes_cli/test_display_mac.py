"""Native Mac screen uses the ticket's pinned home and the server-side lease for input."""

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_cli import web_server
from hermes_cli.dashboard_auth import ws_tickets
from hermes_cli.web_routers import display
from tools.bot_desktop import lease, mac


def test_mac_input_scales_frame_coordinates_and_rejects_outside(monkeypatch):
    sent = []
    monkeypatch.setattr(mac, "_call", lambda method, data: sent.append((method, data)))
    mac.input_event({"type": "click", "x": 750, "y": 490}, frame_size=(1512, 982, 3024, 1964))
    mac.input_event({"type": "move", "x": 750, "y": 490}, frame_size=(1512, 982, 3024, 1964))
    mac.input_event({"type": "click", "button": "right", "x": 750, "y": 490}, frame_size=(1512, 982, 3024, 1964))
    mac.input_event({"type": "scroll", "direction": "down", "amount": 2, "x": 750, "y": 490}, frame_size=(1512, 982, 3024, 1964))
    mac.input_event({"type": "text", "text": "hello world"}, frame_size=(1512, 982, 3024, 1964))
    assert sent == [("click", {"scope": "desktop", "x": 1500, "y": 980}),
                    ("move_cursor", {"scope": "desktop", "x": 1500, "y": 980}),
                    ("click", {"scope": "desktop", "button": "right", "x": 1500, "y": 980}),
                    ("scroll", {"scope": "desktop", "direction": "down", "amount": 2, "x": 1500, "y": 980}),
                    ("type_text", {"scope": "desktop", "text": "hello world"})]
    with pytest.raises(ValueError, match="outside"):
        mac.input_event({"type": "click", "x": -1, "y": 0}, frame_size=(1512, 982, 3024, 1964))
    with pytest.raises(ValueError, match="unsupported key"):
        mac.input_event({"type": "key", "key": "cmd+q"}, frame_size=(1512, 982, 3024, 1964))


def test_mac_driver_error_code_is_not_treated_as_success(monkeypatch):
    class Result:
        returncode = 0
        stdout = '{"code":"invalid_action_target"}'
        stderr = ""
    monkeypatch.setattr(mac.subprocess, "run", lambda *a, **kw: Result())
    with pytest.raises(RuntimeError, match="invalid_action_target"):
        mac._call("click", {"scope": "desktop", "x": 100, "y": 100})


def test_mac_display_ticket_streams_frames_but_filters_input_until_takeover(monkeypatch, tmp_path):
    # Keep lease state inside a temporary home; no real Mac keys/clicks are emitted.
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(display, "_local_mac_home", lambda: str(home))
    monkeypatch.setattr(mac, "enabled", lambda: True)
    monkeypatch.setattr(mac, "capture", lambda: (b"\xff\xd8frame", 200, 100, 400, 200))
    actions = []
    monkeypatch.setattr(mac, "input_event", lambda data, *, frame_size: actions.append((data, frame_size)))
    ws_tickets._reset_for_tests()
    prev = {k: getattr(web_server.app.state, k, None) for k in ("auth_required", "bound_host")}
    web_server.app.state.auth_required = False
    web_server.app.state.bound_host = None
    viewer = "viewer-local"
    ticket = ws_tickets.mint_ticket(user_id="display:" + viewer, provider="bot-desktop",
                                   extra={"hermes_home": str(home), "viewer_id": viewer, "transport": "jpeg"})
    try:
        client = TestClient(web_server.app)
        try:
            with client.websocket_connect(f"/api/display/ws?display_ticket={ticket}") as conn:
                assert conn.receive_json() == {"width": 200, "height": 100}
                assert conn.receive_bytes() == b"\xff\xd8frame"
                conn.send_json({"type": "click", "x": 20, "y": 20})
                assert actions == []
                lease.acquire(viewer, profile_key=str(home))
                conn.send_json({"type": "click", "x": 20, "y": 20})
                # Another frame is sent after the event is handled; callback is async.
                for _ in range(3):
                    conn.receive_json(); conn.receive_bytes()
                    if actions: break
                assert actions == [({"type": "click", "x": 20, "y": 20}, (200, 100, 400, 200))]
        finally:
            client.close()
    finally:
        ws_tickets._reset_for_tests()
        for k, value in prev.items():
            if value is None:
                if hasattr(web_server.app.state, k): delattr(web_server.app.state, k)
            else: setattr(web_server.app.state, k, value)
