import type { SessionInfo } from "@/lib/api";

export interface Conversation { id: string; profile: string; title: string; preview: string; lastActive: number; pinned: boolean }

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
    pinned: !!row.pinned,
  })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActive - a.lastActive);
}
