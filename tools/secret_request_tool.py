"""Model-blind, one-destination secret requests for an authenticated phone client."""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from hermes_constants import get_hermes_home
from tools.registry import registry

_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
_FILE_LOCK = threading.Lock()
_KINDS = ("env_file", "vault_item", "page_field", "remote_file")


def _env_path(raw: str) -> Path:
    home = get_hermes_home()
    if not isinstance(raw, str) or not raw.startswith("~/.hermes/") or "\\" in raw:
        raise ValueError("env_file must be under this profile's ~/.hermes/")
    rel = PurePosixPath(raw[len("~/.hermes/"):])
    if not rel.parts or any(part in (".", "..") for part in raw[len("~/.hermes/"):].split("/")) or rel.suffix != ".env":
        raise ValueError("env_file must be a .env path without traversal")
    path = home.joinpath(*rel.parts)
    if any(p.is_symlink() for p in (path, *path.parents) if p == home or home in p.parents):
        raise ValueError("symlinked secret destination refused")
    return path


def validate_destination(dest: dict, name: str, task_id: str = "") -> dict:
    if not isinstance(dest, dict) or dest.get("kind") not in _KINDS:
        raise ValueError("destination kind must be env_file, vault_item, page_field or remote_file")
    kind = dest["kind"]
    allowed = {"env_file": {"kind", "path"}, "vault_item": {"kind", "origin", "label", "identifier"},
               "page_field": {"kind", "origin", "label", "identifier"}, "remote_file": {"kind", "path"}}[kind]
    if set(dest) - allowed:
        raise ValueError("unknown destination fields")
    if kind in ("env_file", "remote_file"):
        if not _NAME.fullmatch(name or ""):
            raise ValueError("variable name must be 2–64 uppercase letters, digits or underscores")
        path = dest.get("path")
        if kind == "env_file":
            _env_path(path)
        else:
            from tools.terminal_tool import _get_env_config
            cfg = _get_env_config()
            if cfg["env_type"] != "ssh" or cfg["ssh_user"] != "hermes" or not cfg["ssh_host"]:
                raise ValueError("remote_file requires this profile's hermes SSH terminal")
            if not isinstance(path, str) or not path.startswith("/home/hermes/") or "\\" in path:
                raise ValueError("remote_file must be under /home/hermes/")
            rel = PurePosixPath(path).parts
            if len(rel) < 5 or rel[:3] != ("/", "home", "hermes") or rel[3] not in (".hermes", "work") or any(p in (".", "..", "") for p in path.split("/")[1:]):
                raise ValueError("remote_file path must be under hermes/.hermes or hermes/work without traversal")
            if not path.endswith(".env"):
                raise ValueError("remote_file variables require a .env file")
        return {"kind": kind, "path": path}
    from agent.vault_store import VaultError, normalize_origin
    raw_origin = dest.get("origin")
    if not isinstance(raw_origin, str):
        raise ValueError("invalid destination origin")
    try:
        origin = normalize_origin(raw_origin)
    except (VaultError, TypeError):
        raise ValueError("invalid destination origin") from None
    if not origin.startswith("https://") or raw_origin != origin:
        raise ValueError("vault and page destinations require an exact HTTPS origin")
    label, identifier = dest.get("label"), dest.get("identifier")
    if not isinstance(label, str) or not label.strip() or len(label) > 100 or not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 200:
        raise ValueError("login label and identifier are required")
    if kind == "page_field":
        from tools.browser_vault_tool import _current_page_origin, _focus_bound_origin
        _focus_bound_origin(task_id, origin, "login")
        if _current_page_origin(task_id) != origin:
            raise ValueError("open the login form on the exact destination origin first")
    return {"kind": kind, "origin": origin, "label": label.strip(), "identifier": identifier.strip()}


def _write_env(path: Path, name: str, value: str) -> None:
    from hermes_cli.config import _env_line_defines_key, _quote_env_value
    from utils import atomic_write_bytes
    if "\n" in value or "\r" in value or "\x00" in value:
        raise ValueError("file secret must be one line")
    with _FILE_LOCK:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Recheck after mkdir, including existing files: do not write through a symlink.
        if any(p.is_symlink() for p in (path, *path.parents) if p == get_hermes_home() or get_hermes_home() in p.parents):
            raise ValueError("symlinked secret destination refused")
        if path.exists() and (not path.is_file() or path.stat().st_mode & 0o077):
            raise ValueError("existing secret file must be private (0600)")
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True) if path.exists() else []
        lines = [line for line in lines if not _env_line_defines_key(line, name)]
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(f"{name}={_quote_env_value(value)}\n")
        atomic_write_bytes(path, "".join(lines).encode(), mode=0o600, fsync_dir=True)


# No secret bytes in argv, audit, stderr or results. The ssh command is built from the
# requesting profile's terminal policy, not the model's choice of host or user.
_REMOTE_WRITER = '''import os,sys,pathlib,tempfile
path=pathlib.Path(sys.argv[1]); name=sys.argv[2]; remove=len(sys.argv)>3 and sys.argv[3]=="rm"
value=sys.stdin.buffer.read()
if not remove and (b"\\n" in value or b"\\r" in value or b"\\x00" in value): raise SystemExit(2)
base=pathlib.Path("/home/hermes")
if any(p.is_symlink() for p in (path,*path.parents) if p==base or base in p.parents): raise SystemExit(3)
if remove and not path.exists(): print(0); raise SystemExit(0)
path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
if any(p.is_symlink() for p in (path,*path.parents) if p==base or base in p.parents): raise SystemExit(3)
if path.exists() and (not path.is_file() or path.stat().st_mode & 0o077): raise SystemExit(4)
lines=path.read_bytes().splitlines(keepends=True) if path.exists() else []
kept=[line for line in lines if line.split(b"=",1)[0].removeprefix(b"export ").strip()!=name.encode()]
if remove:
 if len(kept)==len(lines): print(0); raise SystemExit(0)
 lines=kept
else:
 lines=kept
 if lines and not lines[-1].endswith(b"\\n"): lines[-1]+=b"\\n"
 lines.append(name.encode()+b"="+value+b"\\n")
fd,tmp=tempfile.mkstemp(dir=path.parent,prefix=".secret-"); os.fchmod(fd,0o600)
try:
 with os.fdopen(fd,"wb") as out:
  out.write(b"".join(lines)); out.flush(); os.fsync(out.fileno())
 os.replace(tmp,path)
finally:
 if os.path.exists(tmp): os.unlink(tmp)
if remove: print(1)
'''


def _remote_command(path: str, name: str, *, remove: bool = False) -> list[str]:
    from tools.terminal_tool import _get_env_config
    cfg = _get_env_config()
    if cfg["env_type"] != "ssh" or cfg["ssh_user"] != "hermes" or not cfg["ssh_host"]:
        raise ValueError("requesting profile no longer has a hermes SSH terminal")
    argv = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-p", str(cfg["ssh_port"])]
    if cfg["ssh_key"]:
        argv.extend(["-i", cfg["ssh_key"]])
    command = f"python3 -c {shlex.quote(_REMOTE_WRITER)} {shlex.quote(path)} {shlex.quote(name)}"
    argv += [f"hermes@{cfg['ssh_host']}", command + (" rm" if remove else "")]
    return argv


def _write_remote(path: str, name: str, value: str) -> None:
    from hermes_cli.config import _quote_env_value
    if "\n" in value or "\r" in value or "\x00" in value:
        raise ValueError("file secret must be one line")
    # Serialize with the same dotenv writer as local env_file; the already-quoted
    # value travels only over SSH stdin, never in argv or model-facing output.
    proc = subprocess.run(_remote_command(path, name), input=_quote_env_value(value).encode(),
                          capture_output=True, timeout=30)
    if proc.returncode:
        raise OSError("remote secret write failed (no value stored)")


def _store(dest: dict, name: str, value: str, task_id: str) -> dict:
    kind = dest["kind"]
    if kind == "env_file":
        _write_env(_env_path(dest["path"]), name, value)
        return {"stored": True, "destination": dest["path"], "var": name}
    if kind == "remote_file":
        _write_remote(dest["path"], name, value)
        return {"stored": True, "destination": dest["path"], "var": name}
    from agent.vault_store import get_vault_store
    identifier = dest["identifier"]
    id_type = "email" if "@" in identifier else ("phone" if identifier.lstrip("+").isdigit() else "username")
    item = get_vault_store().add_item("login", dest["label"],
        {"identifier_type": id_type, "identifier": identifier, "password": value}, origin=dest["origin"])
    if kind == "page_field":
        from tools.browser_vault_tool import browser_vault_fill
        try:
            filled = json.loads(browser_vault_fill(item.id, task_id=task_id))
            if not filled.get("success"):
                raise ValueError("page field could not be filled on the bound origin")
        except Exception:
            get_vault_store().remove_item(item.id)
            raise
    return {"stored": True, "destination": dest["origin"], "handle": item.id}


def _audit(request_id: str, session: str, dest: dict, sub: str, outcome: str, tool_call_id: str = "") -> None:
    from utils import atomic_write_bytes
    path = get_hermes_home() / "logs" / "secret-audit.jsonl"
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "request_id": request_id,
             "profile": get_hermes_home().name, "session": session, "tool_call_id": tool_call_id,
             "destination": dest, "google_sub": sub, "outcome": outcome}
    with _FILE_LOCK:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.is_symlink() or (path.exists() and path.stat().st_mode & 0o077):
            raise ValueError("secret audit log is not private")
        fd = os.open(path, os.O_APPEND | os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            os.write(fd, (json.dumps(entry, separators=(",", ":")) + "\n").encode())
        finally:
            os.close(fd)


def secret_request(name: str, reason: str, destination: dict, expires_in: int = 180,
                   task_id: str | None = None, tool_call_id: str = "") -> str:
    from agent.redact import register_vault_redaction_value
    from tui_gateway.secret_requests import request_secret
    try:
        if not isinstance(name, str) or not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
            raise ValueError("name and a brief reason are required")
        if not isinstance(expires_in, int) or isinstance(expires_in, bool) or not 1 <= expires_in <= 600:
            raise ValueError("expiry must be 1–600 seconds")
        dest = validate_destination(destination, name, task_id or "")
        answer = request_secret(task_id or "", name, reason.strip(), dest, expires_in)
        request_id, value, sub, session = answer
        if not value:
            _audit(request_id, session, dest, sub, "declined", tool_call_id)
            return json.dumps({"stored": False, "error": "expired or declined"})
        register_vault_redaction_value(value)
        try:
            result = _store(dest, name, value, task_id or "")
        except Exception:
            _audit(request_id, session, dest, sub, "write_failed", tool_call_id)
            return json.dumps({"stored": False, "error": "destination write failed"})
        _audit(request_id, session, dest, sub, "stored", tool_call_id)
        return json.dumps(result)
    except (ValueError, RuntimeError) as exc:
        return json.dumps({"stored": False, "error": str(exc)})


def remove_file_secret(name: str, destination: dict) -> bool:
    """Remove only this variable from a typed file destination; never display its value."""
    dest = validate_destination(destination, name)
    if dest["kind"] == "remote_file":
        proc = subprocess.run(_remote_command(dest["path"], name, remove=True),
                              input=b"", capture_output=True, timeout=30)
        if proc.returncode:
            raise OSError("remote secret removal failed")
        return proc.stdout.strip() == b"1"
    if dest["kind"] != "env_file":
        raise ValueError("use hermes vault rm for vault items")
    from hermes_cli.config import _env_line_defines_key
    from utils import atomic_write_bytes
    path = _env_path(dest["path"])
    with _FILE_LOCK:
        if not path.exists():
            return False
        if not path.is_file() or path.stat().st_mode & 0o077:
            raise ValueError("existing secret file must be private (0600)")
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        kept = [line for line in lines if not _env_line_defines_key(line, name)]
        if len(kept) == len(lines):
            return False
        atomic_write_bytes(path, "".join(kept).encode(), mode=0o600, fsync_dir=True)
        return True


registry.register(name="secret_request", toolset="mobile_secrets",
    schema={"name": "secret_request", "description": "Ask the signed-in phone user for a secret; only the typed destination receives its value, never this tool result. Requires an authenticated Google phone session.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string", "description": "Uppercase variable name for file destinations"},
            "reason": {"type": "string", "description": "Why the bot needs it (shown to the user)"},
            "destination": {"type": "object", "description": "Typed destination: env_file {kind,path}, remote_file {kind,path}, vault_item/page_field {kind,origin,label,identifier}", "properties": {
                "kind": {"type": "string", "enum": list(_KINDS)}, "path": {"type": "string"},
                "origin": {"type": "string"}, "label": {"type": "string"}, "identifier": {"type": "string"}}, "required": ["kind"], "additionalProperties": False},
            "expires_in": {"type": "integer", "minimum": 1, "maximum": 600}},
        "required": ["name", "reason", "destination"]}},
    handler=lambda args, **kw: secret_request(args.get("name"), args.get("reason"), args.get("destination"),
        args.get("expires_in", 180), task_id=kw.get("task_id"), tool_call_id=kw.get("tool_call_id", "")))
