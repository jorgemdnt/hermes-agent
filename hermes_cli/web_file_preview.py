"""Read-only, directory-fd-confined preview for local and SSH conversation folders."""
from __future__ import annotations

import os
import stat
from pathlib import Path

MAX_PREVIEW_BYTES = 8 * 1024 * 1024
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
TEXT_TYPES = {".md", ".markdown", ".txt", ".json", ".jsonc", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".css", ".html", ".sh", ".yaml", ".yml", ".toml", ".sql", ".go", ".rs", ".c", ".h", ".cpp", ".java", ".swift", ".xml", ".env.example"}


def preview_kind(name: str) -> str | None:
    suffix = Path(name).suffix.lower()
    if suffix in IMAGE_TYPES:
        return "image"
    if suffix == ".pdf":
        return "pdf"
    if suffix == ".json" or suffix == ".jsonc":
        return "json"
    if suffix in {".md", ".markdown"}:
        return "markdown"
    if suffix in TEXT_TYPES or name in {"Dockerfile", "Makefile", "README", "LICENSE"}:
        return "code"
    return None


def _components(relative: str) -> list[str]:
    if not isinstance(relative, str) or "\x00" in relative or "\\" in relative or relative.startswith("/"):
        raise ValueError("Invalid preview path")
    parts = relative.split("/") if relative else []
    if any(part in {"", ".", ".."} or part.startswith(".") for part in parts):
        raise ValueError("Invalid preview path")
    return parts


def open_confined(root: str, relative: str) -> int:
    """Walk from a trusted root fd; disallow symlinks at *every* component.

    Resolving a string then reopening it races symlink swaps. This fd walk does not.
    The trusted session root may itself be a symlink (resolved before opening).
    """
    parts = _components(relative)
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for index, part in enumerate(parts):
            flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
            if index < len(parts) - 1:
                flags |= os.O_DIRECTORY
            next_fd = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def list_preview(root: str, relative: str) -> list[dict]:
    fd = open_confined(root, relative)
    try:
        if not stat.S_ISDIR(os.fstat(fd).st_mode):
            raise ValueError("Not a directory")
        entries = []
        for name in os.listdir(fd):
            if name.startswith("."):
                continue
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                entries.append({"name": name, "kind": "directory"})
            elif stat.S_ISREG(info.st_mode) and preview_kind(name):
                entries.append({"name": name, "kind": preview_kind(name)})
        return sorted(entries, key=lambda item: (item["kind"] != "directory", item["name"].lower()))
    finally:
        os.close(fd)


def remote_preview(config: dict, root: str, relative: str, view: str) -> dict | tuple[str, bytes]:
    """Run the same fd-confined reader on the bot's SSH host, never on this host."""
    import base64
    import json
    import shlex
    import subprocess
    from tools.environments.ssh import interactive_ssh_argv

    _components(relative)
    if view not in {"list", "content"}:
        raise ValueError("Invalid preview view")
    host, user = config.get("ssh_host"), config.get("ssh_user")
    if not host or not user:
        raise ValueError("Remote preview host is not configured")
    port = int(config.get("ssh_port") or 22)
    argv = interactive_ssh_argv(host, user, port=port, key_path=config.get("ssh_key") or "")
    argv.remove("-tt")
    argv.insert(-1, "-T")
    encoded = base64.urlsafe_b64encode(json.dumps([root, relative, view]).encode()).decode()
    # Keep the confinement code identical on both hosts. SSH stdin supplies our
    # own module source; the remote process has no dependency on a Hermes install.
    script = Path(__file__).read_text() + "\n" + _REMOTE_RUNNER
    try:
        result = subprocess.run([*argv, f"python3 - {shlex.quote(encoded)}"],
                                input=script.encode(), stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError("Remote preview is unavailable") from exc
    if result.returncode != 0:
        raise ValueError("Remote preview could not read this path")
    try:
        payload = json.loads(result.stdout)
        if view == "list":
            return {"folder": payload["folder"], "path": relative, "entries": payload["entries"]}
        return payload["kind"], base64.b64decode(payload["data"], validate=True)
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError("Remote preview returned invalid data") from exc


_REMOTE_RUNNER = '''
import base64, json, sys
root, relative, view = json.loads(base64.urlsafe_b64decode(sys.argv[1]))
root = str(Path(root).expanduser())
if view == "list":
    print(json.dumps({"folder": root, "entries": list_preview(root, relative)}))
else:
    kind, data = read_preview(root, relative)
    print(json.dumps({"kind": kind, "data": base64.b64encode(data).decode()}))
'''


def read_preview(root: str, relative: str) -> tuple[str, bytes]:
    parts = _components(relative)
    kind = preview_kind(parts[-1]) if parts else None
    if not kind:
        raise ValueError("Unsupported preview format")
    fd = open_confined(root, relative)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_PREVIEW_BYTES:
            raise ValueError("File unavailable or too large")
        data = bytearray()
        while len(data) <= MAX_PREVIEW_BYTES:
            chunk = os.read(fd, min(65536, MAX_PREVIEW_BYTES + 1 - len(data)))
            if not chunk:
                return kind, bytes(data)
            data.extend(chunk)
        raise ValueError("File too large")
    finally:
        os.close(fd)
