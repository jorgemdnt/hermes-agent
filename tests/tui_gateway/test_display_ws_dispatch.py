"""A slow VPS SSH screen operation must not hold the WebSocket read loop hostage."""
import threading

from tui_gateway import server


def test_display_rpcs_are_dispatched_off_the_ws_reader(monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    replies = []

    class Transport:
        def write(self, response):
            replies.append(response)
            return True

    def slow(rid, params):
        entered.set()
        assert release.wait(2)
        return server._ok(rid, {"running": True})

    transport = Transport()
    monkeypatch.setitem(server._methods, "display.start", slow)
    try:
        response = server.dispatch({"jsonrpc": "2.0", "id": "start", "method": "display.start", "params": {}}, transport)
        assert response is None, "start must return immediately and write its reply from the worker"
        assert entered.wait(1)
        # A second message on this socket can be read before the remote SSH command finishes.
        assert not replies
    finally:
        release.set()
    for _ in range(100):
        if replies:
            break
        threading.Event().wait(0.01)
    assert replies and replies[0]["id"] == "start"


def test_all_blocking_display_methods_leave_the_reader_free():
    assert {"display.status", "display.start", "display.stop", "display.observe", "display.thumbnail"} <= server._LONG_HANDLERS
