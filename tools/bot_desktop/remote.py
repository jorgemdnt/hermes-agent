"""Samwise's Linux Bot Desktop over the existing SSH terminal path.

Only profiles with ``bot_desktop.remote_ssh`` opt in. The VPS exposes RFB on a Unix socket and
CDP on loopback; SSH forwards both into the profile's private directory on the Mac. No VNC port.
"""
from __future__ import annotations

import hashlib
import json
import os
import shlex
import socket
import subprocess
import time
from pathlib import Path

from hermes_constants import get_hermes_home


def settings() -> dict:
    from hermes_cli.config import load_config_readonly
    cfg = (load_config_readonly().get("bot_desktop") or {}).get("remote_ssh") or {}
    if not cfg.get("host"):
        return {}
    if not all(cfg.get(key) for key in ("user", "source_dir", "cdp_local_port")):
        raise ValueError("bot_desktop.remote_ssh needs host, user, source_dir and cdp_local_port")
    if not str(cfg["source_dir"]).startswith("/") or not 1024 <= int(cfg["cdp_local_port"]) <= 65535:
        raise ValueError("invalid Bot Desktop SSH source_dir or CDP port")
    return cfg


def _state() -> Path:
    return get_hermes_home() / "bot-desktop"


def _ssh(cfg: dict) -> list[str]:
    # Match SSHEnvironment's ControlPath exactly; reuse the samwise terminal's master.
    port = int(cfg.get("port", 22))
    digest = hashlib.sha256(f'{cfg["user"]}@{cfg["host"]}:{port}'.encode()).hexdigest()[:16]
    path = Path(os.environ.get("TMPDIR") or "/tmp") / "hermes-ssh" / f"{digest}.sock"
    args = ["ssh", "-o", f"ControlPath={path}", "-o", "ControlMaster=auto", "-o", "ControlPersist=300",
            "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"]
    if port != 22:
        args += ["-p", str(port)]
    if cfg.get("key_path"):
        args += ["-i", str(cfg["key_path"])]
    return args + [f'{cfg["user"]}@{cfg["host"]}']


def _run(cfg: dict, code: str) -> object:
    source = shlex.quote(str(cfg["source_dir"]))
    # The source checkout's own activated Python has Hermes dependencies; it launches no gateway.
    command = f"cd {source} && HERMES_HOME=$HOME/.hermes HERMES_RUNTIME_DIR=$HOME/.hermes/tools bash -c " + shlex.quote(
        "source ./activate >/dev/null 2>&1 && python -c " + shlex.quote(code))
    result = subprocess.run(_ssh(cfg) + [command], capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError(f"remote Bot Desktop: {result.stderr.strip()[-400:] or 'SSH command failed'}")
    return json.loads(result.stdout.strip())


def status(cfg: dict) -> dict:
    data = _run(cfg, "import json; from tools.bot_desktop.runtime import status; print(json.dumps(status().as_dict()))")
    data["profile"] = "samwise" if get_hermes_home().name == "samwise" else get_hermes_home().name
    # Never disclose the VPS's private socket as if it were accessible to the browser client.
    data["socket"] = str(_state() / "rfb.sock") if data["running"] and ensure_forward(cfg) else None
    data["running"] = bool(data["running"] and data["socket"])
    return data


def _service(cfg: dict, action: str) -> None:
    result = subprocess.run(_ssh(cfg) + [f"systemctl --user {action} hermes-bot-desktop.service"],
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f"VPS Bot Desktop service {action} failed: {result.stderr.strip()[-400:]}")


def start(cfg: dict) -> dict:
    _service(cfg, "start")
    for _ in range(40):
        try:
            _remote_port(cfg)
            return status(cfg)
        except RuntimeError:
            time.sleep(0.25)
    raise RuntimeError("headed Chromium did not open a DevTools port on the VPS")


def stop(cfg: dict) -> dict:
    before = status(cfg)
    _service(cfg, "stop")
    _run(cfg, "import json; from tools.bot_desktop.runtime import stop; print(json.dumps(stop()))")
    close_forward()
    data = status(cfg)
    data["stopped"] = bool(before["running"] and not data["running"])
    return data


def _remote_port(cfg: dict) -> int:
    code = ("import json; from tools.bot_desktop.browser import profile_dir, running_instance_cdp_port; "
            "print(json.dumps(running_instance_cdp_port(str(profile_dir()))))")
    port = _run(cfg, code)
    if not isinstance(port, int) or not 1024 <= port <= 65535:
        raise RuntimeError("start headed Chromium from the VPS Bot Desktop Browser dock before watching")
    return port


def _forward_alive(pid: int, cfg: dict, remote_port: int) -> bool:
    import psutil
    try:
        proc = psutil.Process(pid)
        cmd = proc.cmdline()
        return (proc.is_running() and cmd[0].endswith("ssh") and
                f'127.0.0.1:{int(cfg["cdp_local_port"])}:127.0.0.1:{remote_port}' in cmd and
                str(_state() / "rfb.sock") in " ".join(cmd))
    except (psutil.Error, IndexError):
        return False


def _stop_forward(pid: int, sd: Path) -> None:
    import psutil
    try:
        proc = psutil.Process(pid)
        if proc.name() == "ssh" and str(sd / "rfb.sock") in " ".join(proc.cmdline()):
            proc.terminate()
            proc.wait(timeout=4)
    except psutil.NoSuchProcess:
        pass
    except (psutil.AccessDenied, psutil.TimeoutExpired) as exc:
        raise RuntimeError("Bot Desktop SSH forward could not be stopped") from exc


def close_forward() -> None:
    import fcntl
    sd = _state()
    with (sd / "forward.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pid_file = sd / "forward.pid"
        if pid_file.exists():
            try:
                _stop_forward(int(pid_file.read_text()), sd)
            except ValueError:
                pass
            pid_file.unlink()
        (sd / "rfb.sock").unlink(missing_ok=True)


def ensure_forward(cfg: dict) -> bool:
    import fcntl
    sd = _state()
    sd.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(sd, 0o700)
    with (sd / "forward.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        port = _remote_port(cfg)
        pid_file = sd / "forward.pid"
        try:
            pid = int(pid_file.read_text())
        except (OSError, ValueError):
            pid = 0
        if pid and _forward_alive(pid, cfg, port):
            return (sd / "rfb.sock").exists()
        if pid:
            _stop_forward(pid, sd)
        sock = sd / "rfb.sock"
        sock.unlink(missing_ok=True)
        # SSH does not expand $HOME in a stream-local target; use the user's explicit absolute home.
        remote_sock = f'/home/{cfg["user"]}/.hermes/bot-desktop/rfb.sock'
        argv = _ssh(cfg)
        # Keep the tunnel in its own process. A ControlMaster=auto mux forks an untracked
        # master: killing the recorded client PID leaves its listeners occupying the port.
        argv[1:1] = ["-N", "-o", "ControlMaster=no", "-o", "ControlPath=none",
                        "-o", "ExitOnForwardFailure=yes", "-o", "StreamLocalBindMask=0177",
                        "-L", f"{sock}:{remote_sock}",
                        "-L", f'127.0.0.1:{int(cfg["cdp_local_port"])}:127.0.0.1:{port}']
        with (sd / "forward.log").open("ab") as log:
            proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                    start_new_session=True)
        pid_file.write_text(str(proc.pid))
        for _ in range(30):
            if proc.poll() is not None:
                raise RuntimeError("Bot Desktop SSH forward exited (check forward.log)")
            if sock.exists():
                with socket.socket(socket.AF_UNIX) as probe:
                    try:
                        probe.settimeout(0.2)
                        probe.connect(str(sock))
                        return True
                    except OSError:
                        pass
            time.sleep(0.1)
        raise RuntimeError("Bot Desktop SSH RFB forward did not become ready")


def is_shared_cdp(session_info: dict) -> bool:
    cfg = settings()
    if not cfg or not (session_info.get("features") or {}).get("cdp_override"):
        return False
    url = str(session_info.get("cdp_url") or "")
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return parsed.hostname in ("localhost", "127.0.0.1") and parsed.port == int(cfg["cdp_local_port"])
