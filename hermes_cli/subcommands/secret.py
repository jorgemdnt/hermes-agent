"""Remove a named secret from one allowlisted file (vault items use `hermes vault rm`)."""
from __future__ import annotations


def _remove(args) -> int:
    from tools.secret_request_tool import remove_file_secret

    kind = "remote_file" if args.dest.startswith("/home/hermes/") else "env_file"
    try:
        removed = remove_file_secret(args.name, {"kind": kind, "path": args.dest})
    except (ValueError, OSError) as exc:
        print(f"Secret removal failed: {exc}")
        return 1
    print("Removed." if removed else "No matching variable.")
    return 0


def build_secret_parser(subparsers) -> None:
    parser = subparsers.add_parser("secret", help="Remove a stored file secret without displaying it")
    commands = parser.add_subparsers(dest="secret_action", required=True)
    rm = commands.add_parser("rm", help="Remove NAME from an allowlisted .env file")
    rm.add_argument("name", help="Variable name (uppercase)")
    rm.add_argument("--dest", required=True, help="~/.hermes/*.env or /home/hermes/{.hermes,work}/*.env on the profile's SSH host")
    rm.set_defaults(func=_remove)
