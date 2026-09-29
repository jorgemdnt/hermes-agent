"""Server-owned project selection for /m's first-send workflow.

The browser sends a project ID, never a filesystem path. SSH-backed bots are
explicitly unavailable until worktree creation can run on their host.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from hermes_cli import projects_db, web_git
from hermes_cli.web_bot_terminal import terminal_config
from hermes_cli.web_server_profiles import _resolve_profile_dir

router = APIRouter()
_BRANCH = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,63}$")


class WorkspaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile: str
    project_id: str
    mode: str
    branch: str | None = None


def _project_path(profile: str, project_id: str) -> Path:
    home = _resolve_profile_dir(profile)
    with projects_db.connect_closing(db_path=home / "projects.db") as db:
        project = projects_db.get_project(db, project_id)
    if not project or project.archived or project.id != project_id:
        raise ValueError("Project unavailable. Choose another project.")
    raw = project.primary_path or next((folder.path for folder in project.folders if folder.is_primary), None)
    if not raw:
        raise ValueError("Project has no folder. Add one in Projects first.")
    path = Path(raw).expanduser().resolve()
    if not path.is_dir():
        raise ValueError("Project folder is missing. Restore it or choose another project.")
    return path


def list_workspaces(profile: str) -> dict:
    home = _resolve_profile_dir(profile)
    if terminal_config(profile)["backend"] != "local":
        return {"projects": [], "supported": False, "reason": "Project workspaces on remote bots aren't supported yet. Start a chat without a project."}
    with projects_db.connect_closing(db_path=home / "projects.db") as db:
        projects = projects_db.list_projects(db)
    choices = []
    for project in projects:
        raw = project.primary_path or next((folder.path for folder in project.folders if folder.is_primary), None)
        if not raw:
            continue
        path = Path(raw).expanduser().resolve()
        if path.is_dir():
            choices.append({"id": project.id, "label": project.name, "path": str(path)})
    return {"projects": choices, "supported": True}


def prepare_workspace(request: WorkspaceRequest) -> dict:
    if terminal_config(request.profile)["backend"] != "local":
        raise ValueError("Remote bot worktrees aren't supported yet. Start a chat without a project.")
    if request.mode not in {"local", "worktree"}:
        raise ValueError("Choose Local or New worktree.")
    path = _project_path(request.profile, request.project_id)
    if request.mode == "local":
        return {"cwd": str(path), "branch": None}
    branch = request.branch or ""
    if not _BRANCH.fullmatch(branch) or "//" in branch or branch.endswith("/"):
        raise ValueError("Use a branch name with letters, numbers, /, _ or - (up to 64 characters).")
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


@router.post("/api/mobile/workspace")
async def mobile_workspace(request: WorkspaceRequest):
    try:
        return await run_in_threadpool(prepare_workspace, request)
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
