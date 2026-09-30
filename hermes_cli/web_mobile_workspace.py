"""Server-owned project selection for /m's first-send workflow.

The browser sends a project ID, never a filesystem path. SSH-backed bots
resolve projects and create worktrees on their own terminal host.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from hermes_cli import web_git
from hermes_cli.web_bot_terminal import terminal_config
from hermes_cli.web_mobile_workspace_remote import remote_workspaces
from hermes_cli.web_server_profiles import _resolve_profile_dir

router = APIRouter()
_BRANCH = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,63}$")


class BranchCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch: str


def validate_branch(branch: str) -> None:
    if not _BRANCH.fullmatch(branch):
        raise ValueError("Use a branch name of up to 64 letters, numbers, /, _ or -; start with a letter or number.")
    if subprocess.run(["git", "check-ref-format", "--branch", branch], capture_output=True, check=False).returncode != 0:
        raise ValueError("Invalid Git branch name. Choose another name.")


class WorkspaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile: str
    project_id: str
    mode: str
    branch: str | None = None


def _project_path(profile: str, project_id: str) -> Path:
    selected = next((p for p in list_workspaces(profile)["projects"] if p["id"] == project_id), None)
    if not selected:
        raise ValueError("Project unavailable. Choose another project.")
    return Path(selected["path"])


def list_workspaces(profile: str) -> dict:
    home = _resolve_profile_dir(profile)
    config = terminal_config(profile)
    if config["backend"] == "ssh":
        return remote_workspaces(config, "list")
    if config["backend"] != "local":
        return {"projects": [], "supported": False, "reason": "This bot's terminal cannot create project workspaces."}
    from hermes_state import SessionDB
    from tui_gateway import server

    # Match the desktop plugin's projects.tree, including discovered repositories
    # and folders from previous sessions, not just explicitly registered projects.
    with server._session_profile_runtime_scope({"profile_home": str(home)}, hydrate_secrets=False):
        with SessionDB(home / "state.db") as db:
            tree, _ = server._build_project_tree(db, preview_limit=0, hydrate=False,
                                                 session_limit=2000, include_discovered=True)
    choices = []
    for project in tree["projects"]:
        if project.get("isNoProject"):
            continue
        raw = project.get("path") or next((repo.get("path") for repo in project.get("repos", []) if repo.get("path")), None)
        if not raw:
            continue
        path = Path(raw).expanduser().resolve()
        if path.is_dir():
            is_git = subprocess.run(["git", "-C", str(path), "rev-parse", "--verify", "HEAD"], capture_output=True, check=False).returncode == 0
            choices.append({"id": project["id"], "label": project["label"], "path": str(path), "git": is_git})
    return {"projects": choices, "supported": True}


def prepare_workspace(request: WorkspaceRequest) -> dict:
    _resolve_profile_dir(request.profile)
    config = terminal_config(request.profile)
    if request.mode not in {"local", "worktree"}:
        raise ValueError("Choose Local or New worktree.")
    if request.mode == "worktree":
        validate_branch(request.branch or "")
    if config["backend"] == "ssh":
        return remote_workspaces(config, "prepare", project_id=request.project_id,
                                 mode=request.mode, branch=request.branch)
    if config["backend"] != "local":
        raise ValueError("This bot's terminal cannot create project workspaces.")
    path = _project_path(request.profile, request.project_id)
    if request.mode == "local":
        return {"cwd": str(path), "branch": None}
    branch = request.branch or ""
    if subprocess.run(["git", "-C", str(path), "rev-parse", "--verify", "HEAD"], capture_output=True, check=False).returncode != 0:
        raise ValueError("New worktree needs an existing Git repository with a commit.")
    # web_git.worktree_add resolves the main repository and creates under its
    # configured .worktrees directory. Never silently fall back to the checkout.
    result = web_git.worktree_add(str(path), {"name": branch.replace("/", "-"), "branch": branch})
    return {"cwd": result["path"], "branch": result["branch"]}


@router.get("/api/mobile/projects")
async def mobile_projects(profile: str):
    try:
        return await run_in_threadpool(list_workspaces, profile)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/mobile/branch-check")
async def mobile_branch_check(request: BranchCheckRequest):
    try:
        await run_in_threadpool(validate_branch, request.branch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"valid": True}


@router.post("/api/mobile/workspace")
async def mobile_workspace(request: WorkspaceRequest):
    try:
        return await run_in_threadpool(prepare_workspace, request)
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
