"""Bot shell PTYs: profile-scoped launch configuration, never supplied by the browser."""

from __future__ import annotations

import ipaddress
import os
import shlex
import socket
from pathlib import Path

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
        # No browser-supplied path, host, user, shell command or environment. The
        # configured SSH account (hermes on Samwise) receives the interactive PTY.
        remote = f"cd -- {shlex.quote(cwd)} && exec ${{SHELL:-/bin/bash}} -l"
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
