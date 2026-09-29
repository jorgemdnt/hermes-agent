"""Conversation shell PTYs: profile-scoped backend, stored-session working directory."""

from __future__ import annotations

import ipaddress
import os
import re
import shlex
import socket
import subprocess
from pathlib import Path, PurePosixPath
from typing import Mapping

_SESSION_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

from hermes_cli.config import get_env_value, load_config
from hermes_cli.web_server_profiles import _config_profile_scope
from hermes_cli.web_routers.tools import _terminal_cfg_value


def terminal_config(profile: str) -> dict:
    """Read only the selected profile's terminal settings and SSH identity."""
    with _config_profile_scope(profile):
        cfg = (load_config() or {}).get("terminal") or {}
        backend = str(cfg.get("backend") or get_env_value("TERMINAL_ENV") or "local").strip()
        cwd = str(cfg.get("cwd") or ".").strip()
        result = {"backend": backend, "cwd": cwd}
        if backend == "ssh":
            result.update({key: _terminal_cfg_value(cfg, key, env) for key, env in (
                ("ssh_host", "TERMINAL_SSH_HOST"), ("ssh_user", "TERMINAL_SSH_USER"),
                ("ssh_key", "TERMINAL_SSH_KEY"), ("ssh_port", "TERMINAL_SSH_PORT"))})
        return result


def stored_session_folder(profile: str, session_id: str) -> Mapping[str, str | None] | None:
    """Read the selected conversation from its profile's store, never from a client cwd."""
    if not session_id or session_id == "new":
        return None
    if not _SESSION_ID.fullmatch(session_id):
        raise ValueError("Invalid conversation id")
    from hermes_cli.web_server_sessions import _open_session_db_for_profile, _session_latest_descendant

    db = _open_session_db_for_profile(profile, read_only=True)
    try:
        leaf, _ = _session_latest_descendant(session_id, db)
        session = db.get_session(leaf) if leaf else None
    finally:
        db.close()
    if not session or (session.get("profile_name") and session["profile_name"] != profile):
        raise ValueError("Conversation not found for this bot")
    return session


def remote_folder_exists(config: Mapping[str, str], folder: str) -> bool:
    """Check a recorded cwd on the SSH host, not on the dashboard host."""
    from tools.environments.ssh import interactive_ssh_argv

    host, user = config.get("ssh_host"), config.get("ssh_user")
    if not host or not user:
        raise ValueError("Configure the bot's SSH host and user first")
    try:
        port = int(config.get("ssh_port") or 22)
        argv = interactive_ssh_argv(host, user, port=port, key_path=config.get("ssh_key") or "")
        argv.remove("-tt")
        argv.insert(-1, "-T")
        result = subprocess.run([*argv, f"test -d {shlex.quote(folder)}"],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=12, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError("Remote terminal host is unavailable") from exc
    if result.returncode == 255:
        raise ValueError("Remote terminal host is unavailable")
    return result.returncode == 0


def resolve_terminal_folder(config: Mapping[str, str], session: Mapping[str, str | None] | None) -> str:
    """Session cwd, then its project root, configured cwd, then the backend's home.

    A local path must exist on this host; an SSH path belongs to the remote host
    and must not be checked (or expanded) on the dashboard's host.
    """
    backend = config["backend"]
    for raw in (session.get("cwd") if session else None,
                session.get("git_repo_root") if session else None,
                config.get("cwd")):
        candidate = (raw or "").strip()
        if candidate in ("", "."):
            continue
        if backend == "ssh":
            if candidate == "~":
                return candidate
            if ("\x00" not in candidate and PurePosixPath(candidate).is_absolute()
                    and remote_folder_exists(config, candidate)):
                return candidate
        elif backend == "local":
            path = Path(candidate).expanduser()
            if path.is_absolute() and path.is_dir():
                return str(path.resolve())
        else:
            raise ValueError("Unsupported bot terminal backend")
    return "~" if backend == "ssh" else str(Path.home())


def shell_argv(config: dict) -> tuple[list[str], str | None]:
    """Use local PtyBridge for both hosts; on SSH it owns the interactive ssh client."""
    backend, cwd = config["backend"], config["cwd"]
    if backend == "local":
        # An unset or "." cwd would resolve against the dashboard process's own folder;
        # a person's terminal starts at home instead.
        resolved = Path.home() if cwd in ("", ".") else Path(cwd).expanduser().resolve()
        if not resolved.is_dir():
            raise ValueError("Bot terminal working directory is unavailable")
        return [os.environ.get("SHELL") or "/bin/bash", "-l"], str(resolved)
    if backend == "ssh":
        host, user = config.get("ssh_host"), config.get("ssh_user")
        if not host or not user:
            raise ValueError("Configure the bot's SSH host and user first")
        from tools.environments.ssh import interactive_ssh_argv
        try:
            port = int(config.get("ssh_port") or 22)
        except ValueError as exc:
            raise ValueError("Invalid bot SSH port") from exc
        # The path comes only from the stored session or profile config. Do not
        # resolve a remote cwd on the dashboard host; quote it for the SSH shell.
        target = '"$HOME"' if cwd in ("", ".", "~") else shlex.quote(cwd)
        remote = f"cd -- {target} && exec ${{SHELL:-/bin/bash}} -l"
        return interactive_ssh_argv(host, user, port=port, key_path=config.get("ssh_key") or "") + [remote], None
    raise ValueError(f"Bot terminal backend {backend!r} is not supported (local or SSH required)")


def client_on_server_host(client_ip: str | None) -> bool:
    """A conservative desktop-browser hint; an unknown/proxied peer stays visible."""
    try:
        peer = ipaddress.ip_address(client_ip or "")
        if peer.is_loopback:
            return True
        addresses = socket.getaddrinfo(socket.gethostname(), None)
        if any(peer == ipaddress.ip_address(str(item[4][0]).split("%")[0]) for item in addresses):
            return True
        # MagicDNS hostname lookups omit the host's Tailscale utun address.
        # Uvicorn's trusted proxy headers expose that address as the peer when
        # a desktop browser opens the dashboard through Tailscale Serve.
        try:
            import psutil
        except ImportError:
            return False
        return any(peer == ipaddress.ip_address(address.address.split("%")[0])
                   for interface in psutil.net_if_addrs().values()
                   for address in interface if address.family in {socket.AF_INET, socket.AF_INET6})
    except (ValueError, OSError):
        return False


def public_capabilities(profile: str) -> dict:
    config = terminal_config(profile)
    return {"backend": config["backend"], "local_to_server": config["backend"] == "local"}
