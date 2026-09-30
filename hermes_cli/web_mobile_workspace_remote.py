"""Run project discovery and Git on the terminal host, without installing Hermes there."""
from __future__ import annotations

import json
import shlex
import subprocess

from tools.environments.ssh import interactive_ssh_argv

# Only the profile's configured cwd crosses the host boundary. A browser selects
# a discovered ID; the remote process resolves it again before any write.
REMOTE_WORKSPACES = r'''
import hashlib
import json
from pathlib import Path
import subprocess
import sys

request = json.load(sys.stdin)

def git(path, *args):
    return subprocess.run(['git', '-C', str(path), *args], capture_output=True, text=True)

def choice(path):
    path = path.resolve()
    return {'id': 'ssh_' + hashlib.sha256(str(path).encode()).hexdigest()[:24],
            'label': path.name, 'path': str(path),
            'git': git(path, 'rev-parse', '--verify', 'HEAD').returncode == 0}

def projects():
    raw = request.get('cwd') or '~'
    cwd = Path(raw).expanduser()
    if not cwd.is_absolute():
        cwd = Path.home() / cwd
    candidates = set()
    if cwd.is_dir() and cwd != Path.home():
        candidates.add(cwd.resolve())
    roots = {Path.home() / 'work'}
    if cwd.is_dir() and cwd != Path.home():
        roots.add(cwd.parent)
    for root in roots:
        if root.is_dir():
            candidates.update(p.resolve() for p in root.iterdir()
                              if p.is_dir() and not p.name.startswith('.') and not p.name.endswith('-worktrees'))
    for path in list(candidates):
        result = git(path, 'worktree', 'list', '--porcelain', '-z')
        if result.returncode == 0:
            candidates.update(Path(line[9:]) for line in result.stdout.split('\0')
                              if line.startswith('worktree ') and Path(line[9:]).is_dir())
    return [choice(path) for path in sorted(candidates)]

try:
    choices = projects()
    if request['action'] == 'list':
        result = {'projects': choices, 'supported': True}
    else:
        selected = next((p for p in choices if p['id'] == request['project_id']), None)
        if selected is None:
            raise ValueError('Project unavailable. Choose another project.')
        path = Path(selected['path'])
        if request['mode'] == 'local':
            result = {'cwd': str(path), 'branch': None}
        else:
            if not selected['git']:
                raise ValueError('New worktree needs an existing Git repository with a commit.')
            branch = request['branch']
            if git(path, 'check-ref-format', '--branch', branch).returncode != 0:
                raise ValueError('Invalid Git branch name. Choose another name.')
            common = git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir')
            if common.returncode != 0:
                raise ValueError(common.stderr.strip())
            root = Path(common.stdout.strip()).parent
            target = root.parent / (root.name + '-worktrees') / branch.replace('/', '-')
            target.parent.mkdir(parents=True, exist_ok=True)
            added = git(path, 'worktree', 'add', '-b', branch, str(target), 'HEAD')
            if added.returncode != 0:
                raise ValueError(added.stderr.strip() or 'Could not create worktree')
            result = {'cwd': str(target), 'branch': branch}
    print(json.dumps(result))
except (OSError, ValueError) as exc:
    print(json.dumps({'error': str(exc)}))
    sys.exit(1)
'''


def remote_workspaces(config: dict, action: str, **values) -> dict:
    host, user = config.get("ssh_host"), config.get("ssh_user")
    if not host or not user:
        raise ValueError("Configure the bot's SSH host and user first")
    argv = interactive_ssh_argv(host, user, port=int(config.get("ssh_port") or 22),
                                key_path=config.get("ssh_key") or "")
    argv.remove("-tt")
    argv.insert(-1, "-T")
    try:
        result = subprocess.run([*argv, "python3 -c " + shlex.quote(REMOTE_WORKSPACES)],
                                input=json.dumps({"action": action, "cwd": config.get("cwd"), **values}),
                                capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError("Remote project host is unavailable") from exc
    if result.returncode == 255:
        raise ValueError("Remote project host is unavailable")
    try:
        payload = json.loads(result.stdout)
    except ValueError as exc:
        raise ValueError("Remote project host did not return a workspace result") from exc
    if result.returncode != 0 or "error" in payload:
        raise ValueError(payload.get("error") or "Remote workspace operation failed")
    return payload
