"""Opt-in macOS gateway responsibility, without changing running service definitions.

The profile-local registration is deliberately separate from install/restart. A build
must not silently transfer privacy permissions or restart an active gateway.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile

from hermes_constants import get_hermes_home

BUNDLE_ID = "com.nousresearch.hermes.gateway"
RELATIVE_APP = Path("Contents/Library/LoginItems/Hermes Gateway.app")


def registration_path() -> Path:
    return get_hermes_home() / "privacy-launcher.json"


def validate_app(app: Path) -> str:
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    if (info.get("CFBundleIdentifier"), info.get("CFBundleDisplayName"), info.get("CFBundleExecutable")) != (
        BUNDLE_ID, "Hermes", "HermesGateway"
    ) or info.get("LSBackgroundOnly") is not True:
        raise RuntimeError("Gateway launcher is not the windowless Hermes helper")
    subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(app)], check=True,
                   capture_output=True, timeout=15)
    result = subprocess.run(["/usr/bin/codesign", "-d", "-r-", str(app)], check=True,
                            capture_output=True, text=True, timeout=15)
    requirement = next((line for line in (result.stdout + result.stderr).splitlines()
                        if line.startswith("designated =>")), "")
    if f'identifier "{BUNDLE_ID}"' not in requirement or "cdhash" in requirement:
        raise RuntimeError("Gateway launcher needs a stable, identifier-based signature")
    if not os.access(app / "Contents/MacOS/HermesGateway", os.X_OK):
        raise RuntimeError("Gateway launcher executable is missing")
    return requirement


def _read_registration() -> dict | None:
    path = registration_path()
    if not path.exists():
        return None
    stat = path.stat()
    if path.is_symlink() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise RuntimeError("Gateway privacy registration must be owned by you and owner-only")
    return json.loads(path.read_text())


def registered_launcher() -> Path | None:
    record = _read_registration()
    if record is None or record.get("home") != str(get_hermes_home().resolve()):
        # A --clone-all copy cannot opt a different home into a privacy identity.
        return None
    app = Path(record["app"])
    if not app.is_absolute() or validate_app(app) != record["requirement"]:
        raise RuntimeError("Gateway launcher signature changed; re-register it explicitly")
    return app / "Contents/MacOS/HermesGateway"


def register(desktop_app: Path) -> Path:
    app = desktop_app.resolve() / RELATIVE_APP
    requirement = validate_app(app)
    path = registration_path()
    expected = {"app": str(app), "requirement": requirement, "home": str(get_hermes_home().resolve())}
    current = _read_registration()
    if current is not None:
        # Never overwrite another local privacy supervisor's opt-in.
        if Path(current["app"]) != app:
            raise RuntimeError("Another privacy launcher is registered; inspect it before replacing")
        if current == expected:
            return path
    # Registration with Launch Services must succeed before enabling discovery.
    subprocess.run([
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        "-f", str(app),
    ], check=True, capture_output=True, timeout=15)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as output:
        pending = Path(output.name)
        try:
            json.dump(expected, output, indent=2)
            output.write("\n")
            output.flush()
            pending.replace(path)
        finally:
            pending.unlink(missing_ok=True)
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("register", "status"))
    parser.add_argument("--app", type=Path, default=Path("/Applications/Hermes.app"))
    args = parser.parse_args()
    if args.action == "register":
        print(f"Registered {register(args.app)}; running gateway unchanged. Activate with hermes gateway install --force.")
    else:
        print(registered_launcher() or "Legacy osascript responsibility (not registered)")
