import type { SessionInfo } from "@/lib/api";

export interface Conversation { id: string; profile: string; title: string; preview: string; lastActive: number; createdAt: number; pinned: boolean; unread: boolean; project: string }

// Worktrees created by /m live under the registered repository's .worktrees/.
// Keep their conversations beneath that repository rather than splitting out one group per branch.
export function conversationProject(row: Pick<SessionInfo, "git_repo_root" | "cwd">): string {
  const path = (row.git_repo_root || row.cwd || "").trim();
  return path.replace(/\/\.worktrees\/[^/]+\/?$/, "");
}

// The REST list has already excluded archived, hidden, empty and non-chat sources.
// Keep the Bot Chat door on the bot row, even if an older gateway exposes it here.
export function sideConversations(rows: SessionInfo[], limit: number): Conversation[] {
  const recent = rows.slice(0, limit);
  const window = [...recent, ...rows.slice(limit).filter(row => row.pinned)];
  return window.filter(row => row.title !== "Bot Chat").map(row => ({
    id: row.id,
    profile: row.profile || "default",
    title: row.title?.trim() || row.preview?.trim() || "Untitled session",
    preview: row.preview || "",
    lastActive: row.last_active || row.started_at || 0,
    createdAt: row.started_at || row.last_active || 0,
    pinned: !!row.pinned,
    unread: !!row.unread,
    project: conversationProject(row),
  })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActive - a.lastActive);
}
