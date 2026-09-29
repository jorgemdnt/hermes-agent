#!/usr/bin/env python3
"""Disposable dashboard and installed Hermetic fixture. Never opens real Hermes state."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen

SKILL_REPO = Path(__file__).resolve().parents[4]
REPO = Path(os.environ.get("HERMETIC_REPO", SKILL_REPO if (SKILL_REPO / "hermes_cli").exists() else Path.home() / ".hermes/hermes-agent")).resolve()
QA = Path(os.environ.get("HERMETIC_QA_DIR", str(Path.home() / ".hermes/cache/scratch/hermetic-v2/qa"))).resolve()
# Must not be beneath ~/.hermes: get_default_hermes_root intentionally maps
# any descendant of that tree back to the operator's real profile root.
ROOT = Path.home() / "Library/Caches/hermetic-qa"
HOME = ROOT / "fixture-home"
RUNTIME = ROOT / "fixture-runtime"
PROFILE = ROOT / "electron-profile"
STATE = QA / "fixture.json"
APP = "/Applications/hermetic.app"


def check_scope():
    real = (Path.home() / ".hermes").resolve()
    if HOME.is_relative_to(real):
        raise SystemExit("fixture HERMES_HOME under ~/.hermes resolves to the live root")
    from hermes_constants import get_default_hermes_root
    if get_default_hermes_root(home=HOME).resolve() != HOME:
        raise SystemExit("fixture home resolves to a non-isolated profile root")
    if not REPO.joinpath("hermes_cli/web_dist/index.html").is_file():
        raise SystemExit("Build web first: cd web && npm run build")
    if not Path(APP).exists():
        raise SystemExit("installed /Applications/hermetic.app missing")


def health(port, path="/api/health"):
    try:
        with urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
            return response.status
    except (URLError, OSError):
        return None


def server_env(password, secret):
    # Do not inherit a Kanban worker's HERMES_REAL_HOME, profile, gateway or
    # supervisor variables: they can route this test dashboard to the live bot.
    env = {key: os.environ[key] for key in ("HOME", "PATH", "LANG", "LC_CTYPE") if key in os.environ}
    env.update({"HERMES_HOME": str(HOME), "HERMES_RUNTIME_DIR": str(RUNTIME),
                "HERMES_WEB_DIST": str(REPO / "hermes_cli/web_dist"), "PYTHONPATH": str(REPO),
                "HERMES_DASHBOARD_BASIC_AUTH_USERNAME": "qa-user",
                "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD": password,
                "HERMES_DASHBOARD_BASIC_AUTH_SECRET": secret,
                "HERMES_IGNORE_RULES": "1"})
    return env


def launch_server(port, password, secret):
    log = open(QA / "dashboard.log", "a")
    proc = subprocess.Popen([str(REPO / ".venv/bin/hermes"), "dashboard", "--no-open", "--skip-build", "--host", "127.0.0.1", "--port", str(port)], cwd=REPO, env=server_env(password, secret), stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    log.close()
    for _ in range(100):
        if health(port) == 200:
            return proc
        if proc.poll() is not None:
            raise SystemExit(f"dashboard exited {proc.returncode}; see {QA / 'dashboard.log'}")
        time.sleep(.2)
    raise SystemExit(f"dashboard not ready; see {QA / 'dashboard.log'}")


def start():
    check_scope()
    if STATE.exists():
        raise SystemExit(f"fixture already exists: {STATE}; stop it first")
    QA.mkdir(parents=True, exist_ok=True)
    # Keep screenshots/report, but never reuse a Git worktree from a prior fixture.
    if (QA / "projects").exists():
        shutil.rmtree(QA / "projects")
    ROOT.mkdir(parents=True, exist_ok=True)
    HOME.mkdir(mode=0o700)
    RUNTIME.mkdir(mode=0o700)
    PROFILE.mkdir(mode=0o700)
    (HOME / "profiles/atlas").mkdir(parents=True)
    (HOME / "config.yaml").write_text("gateway:\n  multiplex_profiles: true\ndashboard:\n  public_url: https://hermetic-qa.invalid\n")
    (HOME / ".env").write_text("")
    (HOME / "profiles/atlas/config.yaml").write_text("{}\n")
    (HOME / "profiles/atlas/.env").write_text("")
    (HOME / "SOUL.md").write_text("# Fixture bot\n")
    (HOME / "profiles/atlas/SOUL.md").write_text("# Atlas fixture bot\n")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    from hermes_state import SessionDB
    for sid, owner, title, cwd, message in [
        ("qa-default-long", "default", "The very long conversation title about reviewing the distributed release workflow", str(QA / "projects/orion"), "QA assistant reply: the release is ready. This text should scroll under the floating bot pill."),
        ("qa-default-short", "default", "Second conversation", str(QA / "projects/orion"), "A second reply for switching."),
        ("qa-atlas", "atlas", "Atlas fixture conversation", str(QA / "projects/nebula"), "Atlas replies from its own profile."),
    ]:
        Path(cwd).mkdir(parents=True, exist_ok=True)
        (Path(cwd) / "fixture.md").write_text("# QA project\n\nRead-only file preview from the isolated QA folder.\n")
        db = SessionDB((HOME if owner == "default" else HOME / "profiles" / owner) / "state.db")
        try:
            db.create_session(sid, "webui", profile_name=owner, cwd=cwd)
            db.set_session_title(sid, title)
            db.append_message(sid, "user", f"Question for {title}")
            db.append_message(sid, "assistant", message)
            if sid == "qa-default-long":
                for index in range(12):
                    db.append_message(sid, "user" if index % 2 else "assistant", f"Scroll proof row {index + 1}: fixture text passing behind the floating identity pill, without a header bar. " * 3)
                db.append_message(sid, "user", "[IMPORTANT: Background process qa-a completed normally (exit code 0).]")
                db.append_message(sid, "user", "[IMPORTANT: Background process qa-b completed normally (exit code 0).]")
                db.append_message(sid, "assistant", f"Fixture transcript complete. Open http://localhost:{port}/api/health in the split browser.")
            if sid == "qa-default-short":
                db.set_session_read(sid, False)
        finally:
            db.close()
    # A real throwaway repository & first-class Project for first-send QA.
    from hermes_cli import projects_db
    repo = QA / "projects/orion"
    subprocess.run(["git", "init", "-b", "main"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "-c", "user.email=qa@example.test", "-c", "user.name=QA", "commit", "--allow-empty", "-m", "fixture"], cwd=repo, check=True, capture_output=True)
    with projects_db.connect_closing(db_path=HOME / "projects.db") as db:
        projects_db.create_project(db, name="Orion", primary_path=str(repo))
    with projects_db.connect_closing(db_path=HOME / "profiles/atlas/projects.db") as db:
        projects_db.create_project(db, name="Nebula", primary_path=str(QA / "projects/nebula"))
    # QA-only credentials. Never reuse or copy the operator's secret store.
    password = secrets.token_urlsafe(18)
    secret = secrets.token_hex(32)
    proc = launch_server(port, password, secret)
    state = {"server_pid": proc.pid, "port": port, "password": password, "secret": secret, "app_profile": str(PROFILE)}
    STATE.write_text(json.dumps(state, indent=2))
    STATE.chmod(0o600)
    (PROFILE / "settings.json").write_text(json.dumps({"dashboardUrl": f"http://127.0.0.1:{port}/m"}))
    subprocess.run(["open", "-g", "-n", "--env", f"HERMETIC_USER_DATA={PROFILE}", APP, "--args", "--remote-debugging-port=0"], check=True)
    portfile = PROFILE / "DevToolsActivePort"
    for _ in range(100):
        if portfile.exists():
            state["cdp_port"] = int(portfile.read_text().splitlines()[0])
            STATE.write_text(json.dumps(state, indent=2))
            print(json.dumps({"url": f"http://127.0.0.1:{port}/m", "cdp_port": state["cdp_port"], "pid": proc.pid, "state": str(STATE)}))
            return
        time.sleep(.2)
    raise SystemExit("installed app did not write DevToolsActivePort; run stop")


def doctor():
    check_scope()
    state = json.loads(STATE.read_text())
    port = state["port"]
    pages = json.loads(urlopen(f"http://127.0.0.1:{state['cdp_port']}/json", timeout=2).read())
    expected = f"http://127.0.0.1:{port}"
    pid_up = subprocess.run(["kill", "-0", str(state["server_pid"])], capture_output=True).returncode == 0
    result = {"server_pid_up": pid_up, "health": health(port), "login": health(port, "/login"),
              "cdp_port": state["cdp_port"], "app_pages": [p["url"] for p in pages if p["type"] == "page"],
              "profile": str(PROFILE), "isolated": HOME != Path.home() / ".hermes"}
    print(json.dumps(result, indent=2))
    if not pid_up or result["health"] != 200 or not any(p["url"].startswith(expected) for p in pages):
        raise SystemExit(1)


def restart():
    check_scope()
    state = json.loads(STATE.read_text())
    if health(state["port"]) != 200:
        raise SystemExit("server already down; only restart a healthy owned fixture")
    os.killpg(state["server_pid"], signal.SIGTERM)
    for _ in range(50):
        if health(state["port"]) is None:
            break
        time.sleep(.1)
    if health(state["port"]) is not None:
        raise SystemExit("old server still owns fixture port")
    proc = launch_server(state["port"], state["password"], state["secret"])
    state["server_pid"] = proc.pid
    STATE.write_text(json.dumps(state, indent=2))
    print(f"restarted fixture dashboard on {state['port']} pid={proc.pid}; installed app remains open")


def stop():
    if not STATE.exists():
        print("no fixture state; nothing to stop")
        return
    state = json.loads(STATE.read_text())
    port = state.get("cdp_port")
    if port:
        try:
            browser = json.loads(urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2).read())
            if browser.get("webSocketDebuggerUrl"):
                # Browser.close via helper, not process-name kill. Do not touch other app windows.
                subprocess.run(["node", str(Path(__file__).with_name("cdp.mjs")), "--port", str(port), "close"], timeout=6, check=False)
        except (URLError, TimeoutError):
            pass
    pid = state.get("server_pid")
    if pid and health(state["port"]) == 200:
        os.killpg(pid, signal.SIGTERM)
    for _ in range(30):
        try:
            urlopen(f"http://127.0.0.1:{state['port']}/api/health", timeout=.2)
        except (URLError, OSError):
            break
        time.sleep(.1)
    import shutil
    if ROOT.name == "hermetic-qa" and not health(state["port"]):
        shutil.rmtree(ROOT, ignore_errors=True)
    STATE.unlink()
    print(f"stopped fixture; retained {QA / 'screenshots'} and {QA / 'report.md'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "doctor", "restart", "stop"])
    args = parser.parse_args()
    if args.action == "start": start()
    elif args.action == "doctor": doctor()
    elif args.action == "restart": restart()
    else: stop()
