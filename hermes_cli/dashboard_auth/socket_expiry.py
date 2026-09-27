"""Expire ticket-authenticated dashboard WebSockets at their access-session deadline.

The upgrade gate stamps the verified session expiry into the ASGI scope. This wrapper
applies to every route using that gate (including plugin sockets), without changing
server-internal and loopback connections. No refresh token rides on the WebSocket:
the browser obtains a fresh ticket over HTTP and reconnects after 4401.
"""
from __future__ import annotations

import asyncio
import contextlib
import time


class SessionSocketExpiry:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "websocket":
            return await self.app(scope, receive, send)

        deadline_task: asyncio.Task[None] | None = None
        expired = asyncio.Event()
        closed = False

        async def close_at_deadline():
            nonlocal closed
            deadline = scope["hermes_session_expires_at"]
            await asyncio.sleep(max(0, deadline - time.time()))
            if not closed:
                closed = True
                try:
                    await send({"type": "websocket.close", "code": 4401, "reason": "session expired"})
                finally:
                    expired.set()

        async def guarded_send(message):
            nonlocal deadline_task, closed
            if closed:
                return
            if message["type"] == "websocket.accept" and "hermes_session_expires_at" in scope:
                deadline = scope["hermes_session_expires_at"]
                if deadline <= time.time():
                    closed = True
                    return await send({"type": "websocket.close", "code": 4401, "reason": "session expired"})
                await send(message)
                deadline_task = asyncio.create_task(close_at_deadline())
                return
            if message["type"] == "websocket.close":
                closed = True
            await send(message)

        async def guarded_receive():
            if deadline_task is None:
                return await receive()
            if expired.is_set():
                return {"type": "websocket.disconnect", "code": 4401}
            pending = asyncio.create_task(receive())
            wake = asyncio.create_task(expired.wait())
            try:
                done, _ = await asyncio.wait({pending, wake}, return_when=asyncio.FIRST_COMPLETED)
                if wake in done:
                    return {"type": "websocket.disconnect", "code": 4401}
                return pending.result()
            finally:
                for task in (pending, wake):
                    if not task.done():
                        task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await task

        try:
            await self.app(scope, guarded_receive, guarded_send)
        finally:
            closed = True
            if deadline_task is not None:
                deadline_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await deadline_task
