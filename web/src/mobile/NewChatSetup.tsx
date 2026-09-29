import { Check, Circle, FolderGit2, LoaderCircle } from "lucide-react";

export interface ProjectChoice { id: string; label: string; path: string }
export type WorkspaceMode = "local" | "worktree";
export type CreationStep = "worktree" | "chat" | "working";
export interface CreationProgress { step: CreationStep; error?: string }

const steps: ReadonlyArray<{ id: CreationStep; label: string }> = [
  { id: "worktree", label: "Creating worktree" },
  { id: "chat", label: "Starting chat" },
  { id: "working", label: "Bot is working" },
];

export function NewChatSetup({ bot, projects, supported, reason, projectId, onProject, mode, onMode, branch, onBranch, progress, onRetry, compact = false }: {
  bot: string; projects: ProjectChoice[]; supported: boolean; reason?: string;
  projectId: string; onProject: (id: string) => void; mode: WorkspaceMode; onMode: (mode: WorkspaceMode) => void;
  branch: string; onBranch: (branch: string) => void; progress: CreationProgress | null; onRetry: () => void; compact?: boolean;
}) {
  const selected = projects.find(project => project.id === projectId);
  return <section className="m-new-chat" aria-label="New conversation">
    {!compact && <><div className="m-new-chat-hero"><span className="m-new-chat-mark" aria-hidden="true">✦</span><h2>New conversation with {bot}</h2><p>Choose where this conversation will work, then send a message.</p></div>
    <div className="m-new-chat-settings">
      <label htmlFor="m-new-project"><FolderGit2 size={16} aria-hidden="true" />Project</label>
      <select id="m-new-project" name="project" value={projectId} disabled={!!progress && !progress.error || !supported} onChange={event => onProject(event.target.value)}>
        <option value="">No project</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.label}</option>)}
      </select>
      {selected && <p className="m-new-project-path" title={selected.path}>{selected.path}</p>}
      {!supported && <p className="m-new-hint">{reason}</p>}
      {selected && <>
        <div className="m-new-mode" role="group" aria-label="Workspace">
          <button type="button" aria-pressed={mode === "local"} disabled={!!progress && !progress.error} onClick={() => onMode("local")}>Local</button>
          <button type="button" aria-pressed={mode === "worktree"} disabled={!!progress && !progress.error} onClick={() => onMode("worktree")}>New worktree</button>
        </div>
        {mode === "worktree" && <label className="m-new-branch" htmlFor="m-new-branch">Branch name
          <input id="m-new-branch" name="branch" autoComplete="off" spellCheck={false} value={branch} onChange={event => onBranch(event.target.value)} placeholder="feat/my-change" />
        </label>}
      </>}
    </div></>}
    {progress && <ol className="m-creation-progress" aria-label="Conversation creation progress" aria-live="polite">
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
    </ol>}
  </section>;
}
