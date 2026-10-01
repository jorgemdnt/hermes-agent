#!/usr/bin/env python3
"""Build the windowless responsible app before the desktop's outer signing seal."""
from __future__ import annotations

import argparse
from pathlib import Path
import plistlib
import shutil
import subprocess

BUNDLE_ID = "com.nousresearch.hermes.gateway"
RELATIVE_APP = Path("Contents/Library/LoginItems/Hermes Gateway.app")
SOURCE = Path(__file__).resolve().parents[2] / "apps/desktop/native/gateway-launcher.m"


def build_launcher(app: Path, *, identity: str = "-", keychain: str | None = None,
                   arch: str | None = None) -> Path:
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    helper = app / RELATIVE_APP
    executable = helper / "Contents/MacOS/HermesGateway"
    executable.parent.mkdir(parents=True, exist_ok=True)
    resources = helper / "Contents/Resources"
    resources.mkdir(exist_ok=True)
    icon = info["CFBundleIconFile"]
    if not icon.endswith(".icns"):
        icon += ".icns"
    shutil.copy2(app / "Contents/Resources" / icon, resources / "Hermes.icns")
    (helper / "Contents/Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleName": "Hermes",
        "CFBundleDisplayName": "Hermes",
        "CFBundleExecutable": executable.name,
        "CFBundleIconFile": "Hermes.icns",
        "CFBundlePackageType": "APPL",
        "CFBundleVersion": info["CFBundleVersion"],
        "LSBackgroundOnly": True,
        "NSLocalNetworkUsageDescription": "Connect Hermes to local services you configure.",
        "NSAppleEventsUsageDescription": "Automate apps you explicitly ask Hermes to control.",
    }))
    compile_args = ["/usr/bin/clang", "-fobjc-arc", "-Wall", "-Wextra", "-Werror",
                    "-framework", "Foundation", "-framework", "ApplicationServices"]
    if arch:
        compile_args += ["-arch", arch]
    subprocess.run([*compile_args, str(SOURCE), "-o", str(executable)], check=True, timeout=60)
    args = ["/usr/bin/codesign", "--force", "--sign", identity, "--timestamp=none",
            "--entitlements", str(SOURCE.with_name("gateway-entitlements.plist"))]
    if keychain:
        args += ["--keychain", keychain]
    if identity == "-":
        args += ["--requirements", f'=designated => identifier "{BUNDLE_ID}"']
    subprocess.run([*args, str(helper)], check=True, timeout=60)
    subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(helper)], check=True, timeout=30)
    return helper


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--identity", default="-")
    parser.add_argument("--keychain")
    parser.add_argument("--arch", choices=("arm64", "x86_64"))
    args = parser.parse_args()
    print(build_launcher(args.app, identity=args.identity, keychain=args.keychain, arch=args.arch))
