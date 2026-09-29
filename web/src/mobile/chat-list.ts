import type { Conversation } from "./conversations";

export type ChatSort = "recent" | "created";
export const CHAT_SORTS: ReadonlyArray<{ value: ChatSort; label: string }> = [
  { value: "recent", label: "Recent activity" },
  { value: "created", label: "Date created" },
];
export const NO_PROJECT = "";

export interface ChatGroup { key: string; label: string; chats: Conversation[] }
export interface ChatLayout { groups: ChatGroup[]; visible: Conversation[] }

export const chatKeyOf = (chat: Pick<Conversation, "profile" | "id">) => `${chat.profile}/${chat.id}`;
export const projectLabel = (project: string) => project ? project.replace(/\/+$/, "").split("/").pop() || project : "No project";
const stamp = (chat: Conversation, sort: ChatSort) => sort === "created" ? chat.createdAt : chat.lastActive;

export function sortChats(chats: Conversation[], sort: ChatSort): Conversation[] {
  return [...chats].sort((a, b) => Number(b.pinned) - Number(a.pinned) || stamp(b, sort) - stamp(a, sort));
}

export const unreadCount = (chats: Conversation[]) => chats.filter(chat => chat.unread).length;

export function filterChats(chats: Conversation[], query: string, botName: (profile: string) => string): Conversation[] {
  const needle = query.trim().toLowerCase();
  return needle ? chats.filter(chat => `${chat.title} ${chat.preview} ${botName(chat.profile)}`.toLowerCase().includes(needle)) : chats;
}

/** Groups and the flat order of what is on screen (collapsed groups contribute no rows). */
export function chatLayout(chats: Conversation[], { sort, grouped, collapsed, projectNames = {} }: { sort: ChatSort; grouped: boolean; collapsed: ReadonlySet<string>; projectNames?: Readonly<Record<string, string>> }): ChatLayout {
  const sorted = sortChats(chats, sort);
  const groups: ChatGroup[] = grouped ? [] : [{ key: "*", label: "", chats: sorted }];
  if (grouped) {
    const byProject = new Map<string, Conversation[]>();
    for (const chat of sorted) byProject.set(chat.project, [...(byProject.get(chat.project) ?? []), chat]);
    for (const [key, rows] of byProject) groups.push({ key, label: projectNames[key] || projectLabel(key), chats: rows });
    // Groups follow their newest row; "No project" always last.
    groups.sort((a, b) => Number(a.key === NO_PROJECT) - Number(b.key === NO_PROJECT));
  }
  const visible = groups.flatMap(group => grouped && collapsed.has(group.key) ? [] : group.chats);
  return { groups, visible };
}

export function adjacentChat(visible: Conversation[], current: string, direction: 1 | -1): Conversation | undefined {
  if (!visible.length) return undefined;
  const index = visible.findIndex(chat => chatKeyOf(chat) === current);
  if (index < 0) return direction === 1 ? visible[0] : visible.at(-1);
  return visible[index + direction];
}

export function loadStringSet(storage: Pick<Storage, "getItem">, key: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch { return new Set(); }
}
