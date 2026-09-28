"""The default profile's local Mac screen, captured and controlled by the installed cua-driver.

No unauthenticated VNC server or extra listening port. The dashboard's ticketed WebSocket
ships JPEG frames; input is accepted only while this viewer owns the profile's lease.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from hermes_constants import get_hermes_home


def enabled() -> bool:
    # Other local profiles do not get to claim the default bot's physical Mac as their screen.
    return sys.platform == "darwin" and get_hermes_home() == Path.home() / ".hermes"


def _driver() -> str:
    app = Path("/Applications/CuaDriver.app/Contents/MacOS/cua-driver")
    if not app.is_file():
        raise RuntimeError("Install and authorize CuaDriver to watch this Mac screen")
    return str(app)


def _call(method: str, args: dict, *, timeout: int = 15) -> dict:
    result = subprocess.run([_driver(), "call", method, json.dumps(args)], capture_output=True,
                            text=True, timeout=timeout, env={**os.environ, "CUA_DRIVER_RS_TELEMETRY_ENABLED": "0"})
    if result.returncode:
        raise RuntimeError(f"Mac screen {method}: {result.stderr.strip()[-300:] or 'CuaDriver failed'}")
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Mac screen {method}: invalid CuaDriver response") from exc
    if data.get("isError") or data.get("error") or data.get("code"):
        raise RuntimeError(f"Mac screen {method}: {str(data.get('error') or data.get('code') or data)[-300:]}")
    return data


def status() -> dict:
    available = Path("/Applications/CuaDriver.app/Contents/MacOS/cua-driver").is_file()
    return {"profile": "default", "supported": True, "installed": available, "missing": [] if available else ["CuaDriver"],
            "running": available, "pid": None, "display": "Mac desktop", "socket": None,
            "geometry": "1512x982", "install_command": None, "browser": None,
            "blocker": None if available else "Install and authorize CuaDriver to watch this Mac screen",
            "memory_available_mb": None, "memory_limit_mb": None, "transport": "jpeg"}


def capture() -> tuple[bytes, int, int, int, int]:
    """Private temporary PNG, immediately removed. Resize on the server to bound phone bandwidth."""
    from PIL import Image
    with tempfile.TemporaryDirectory(prefix="hermes-screen-") as directory:
        path = Path(directory) / "frame.png"
        data = _call("get_desktop_state", {"screenshot_out_file": str(path)}, timeout=20)
        if not path.is_file():
            raise RuntimeError("CuaDriver did not capture the Mac screen; check Screen Recording permission")
        with Image.open(path) as image:
            raw_width, raw_height = image.size
            image.thumbnail((1512, 982), Image.Resampling.LANCZOS)
            width, height = image.size
            from io import BytesIO
            output = BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=70)
            return output.getvalue(), width, height, raw_width, raw_height


def input_event(event: dict, *, frame_size: tuple[int, int, int, int]) -> None:
    """Whitelist only a desktop click or a single key. Untrusted WebSocket JSON never becomes argv."""
    width, height, input_width, input_height = frame_size
    if event.get("type") == "click":
        x, y = event.get("x"), event.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not 0 <= x < width or not 0 <= y < height:
            raise ValueError("click outside the screen")
        _call("click", {"scope": "desktop", "x": x * input_width / width, "y": y * input_height / height})
    elif event.get("type") == "key":
        key = event.get("key")
        keys = {"return", "tab", "escape", "up", "down", "left", "right", "space", "delete", "home", "end"}
        if not isinstance(key, str) or not (len(key) == 1 and key.isalnum() and key.isascii() or key in keys):
            raise ValueError("unsupported key")
        modifiers = event.get("modifiers", [])
        if not isinstance(modifiers, list) or len(modifiers) > 3 or any(m not in {"cmd", "ctrl", "alt", "shift"} for m in modifiers):
            raise ValueError("unsupported modifiers")
        _call("press_key", {"scope": "desktop", "key": key, "modifiers": modifiers})
    else:
        raise ValueError("unsupported screen input")
