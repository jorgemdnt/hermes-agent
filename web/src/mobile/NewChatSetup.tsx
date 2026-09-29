import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Circle, Folder, FolderGit2, GitBranch, LoaderCircle } from "lucide-react";

export interface ProjectChoice { id: string; label: string; path: string }
export type WorkspaceMode = "local" | "worktree";
export type CreationStep = "worktree" | "chat" | "working";
export interface CreationProgress { step: CreationStep; error?: string }

const steps: ReadonlyArray<{ id: CreationStep; label: string }> = [
  { id: "worktree", label: "Creating worktree" },
  { id: "chat", label: "Starting chat" },
  { id: "working", label: "Bot is working" },
];

export function NewChatHero({ projects, projectId, onProject, disabled }: {
  projects: ProjectChoice[]; projectId: string; onProject: (id: string) => void; disabled: boolean;
}) {
  const selected = projects.find(project => project.id === projectId);
  return <section className="m-new-chat" aria-label="New conversation">
    <h1 aria-label={selected ? `What should we build in ${selected.label}?` : "What should we build?"}>
      {selected ? "What should we build in " : "What should we build"}
      {selected && <DropdownMenu.Root>
        <DropdownMenu.Trigger className="m-new-project-picker" disabled={disabled}>{selected.label}<ChevronDown size={16} aria-hidden="true" /></DropdownMenu.Trigger>
        <DropdownMenu.Portal container={document.querySelector<HTMLElement>(".m-shell")}>
          <DropdownMenu.Content className="m-dropdown m-new-picker-menu" align="center" sideOffset={8} collisionPadding={12}>
            <DropdownMenu.RadioGroup value={projectId} onValueChange={onProject}>
              <DropdownMenu.RadioItem value=""><Check size={14} className="m-check" aria-hidden="true" />No project</DropdownMenu.RadioItem>
              {projects.map(project => <DropdownMenu.RadioItem key={project.id} value={project.id} title={project.path}><Check size={14} className="m-check" aria-hidden="true" />{project.label}</DropdownMenu.RadioItem>)}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>}{"?"}
    </h1>
  </section>;
}

export function NewChatToolbar({ projects, supported, reason, projectId, onProject, mode, onMode, branch, onBranch, branchError, disabled }: {
  projects: ProjectChoice[]; supported: boolean; reason?: string; projectId: string; onProject: (id: string) => void;
  mode: WorkspaceMode; onMode: (mode: WorkspaceMode) => void; branch: string; onBranch: (branch: string) => void;
  branchError: string; disabled: boolean;
}) {
  const selected = projects.find(project => project.id === projectId);
  return <div className="m-new-context">
    <div className="m-new-context-row">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="m-context-picker" aria-label="Project" disabled={disabled || !supported} title={selected?.path || "No project"}><Folder size={15} aria-hidden="true" /><span>{selected?.label || "No project"}</span><ChevronDown size={13} aria-hidden="true" /></DropdownMenu.Trigger>
        <DropdownMenu.Portal container={document.querySelector<HTMLElement>(".m-shell")}><DropdownMenu.Content className="m-dropdown m-new-picker-menu" align="start" side="top" sideOffset={6} collisionPadding={12}>
          <DropdownMenu.RadioGroup value={projectId} onValueChange={onProject}>
            <DropdownMenu.RadioItem value=""><Check size={14} className="m-check" aria-hidden="true" />No project</DropdownMenu.RadioItem>
            {projects.map(project => <DropdownMenu.RadioItem key={project.id} value={project.id} title={project.path}><Check size={14} className="m-check" aria-hidden="true" />{project.label}</DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
      {selected && <DropdownMenu.Root>
        <DropdownMenu.Trigger className="m-context-picker" aria-label="Workspace" disabled={disabled}><FolderGit2 size={15} aria-hidden="true" /><span>{mode === "worktree" ? "New worktree" : "Current checkout"}</span><ChevronDown size={13} aria-hidden="true" /></DropdownMenu.Trigger>
        <DropdownMenu.Portal container={document.querySelector<HTMLElement>(".m-shell")}><DropdownMenu.Content className="m-dropdown m-new-picker-menu" align="start" side="top" sideOffset={6} collisionPadding={12}>
          <DropdownMenu.RadioGroup value={mode} onValueChange={value => onMode(value === "worktree" ? "worktree" : "local")}>
            <DropdownMenu.RadioItem value="local"><Check size={14} className="m-check" aria-hidden="true" />Current checkout</DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="worktree"><Check size={14} className="m-check" aria-hidden="true" />New worktree</DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>}
      {selected && mode === "worktree" && <label className="m-new-branch" htmlFor="m-new-branch"><GitBranch size={14} aria-hidden="true" /><span className="sr-only">New branch name</span><input id="m-new-branch" name="branch" autoComplete="off" spellCheck={false} aria-invalid={!!branchError} aria-describedby={branchError ? "m-new-branch-error" : undefined} value={branch} onChange={event => onBranch(event.target.value)} disabled={disabled} placeholder="Branch from message…" /></label>}
    </div>
    {branchError && <p id="m-new-branch-error" role="alert" className="m-new-validation">{branchError}</p>}
    {!supported && reason && <p className="m-new-hint">{reason}</p>}
  </div>;
}

export function CreationStatus({ progress, mode, onRetry }: { progress: CreationProgress; mode: WorkspaceMode; onRetry: () => void }) {
  return <ol className="m-creation-progress" aria-label="Conversation creation progress" aria-live="polite">
    {steps.filter(step => mode === "worktree" || step.id !== "worktree").map(step => {
      const order = steps.findIndex(item => item.id === step.id);
      const active = progress.step === step.id;
      const finished = order < steps.findIndex(item => item.id === progress.step);
      return <li key={step.id} data-state={active && progress.error ? "failed" : active ? "active" : finished ? "done" : "pending"}>
        {finished ? <Check size={16} aria-hidden="true" /> : active && !progress.error ? <LoaderCircle size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
        <span>{step.label}{active && !progress.error && step.id !== "working" ? "…" : ""}</span>
        {active && progress.error && <div role="alert" className="m-creation-error">{progress.error}<button type="button" onClick={onRetry}>Retry</button></div>}
      </li>;
    })}
  </ol>;
}
