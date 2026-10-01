import type { MenuAction } from "./context-menu";
import type { Conversation } from "./conversations";

// Labels and permission conditions live here once; the ContextMenu and the touch sheet only render them.
export function botActions(name: string, pinnedNames: readonly string[], ops: { togglePin: () => void; move: (direction: -1 | 1) => void; terminal: () => void }): MenuAction[] {
  const index = pinnedNames.indexOf(name);
  const actions: MenuAction[] = [{ id: "pin", label: index >= 0 ? "Unpin bot" : "Pin bot", onSelect: ops.togglePin }];
  if (index > 0) actions.push({ id: "left", label: "Move pin left", onSelect: () => ops.move(-1), stay: true });
  if (index >= 0 && index < pinnedNames.length - 1) actions.push({ id: "right", label: "Move pin right", onSelect: () => ops.move(1), stay: true });
  actions.push({ id: "terminal", label: "Terminal", onSelect: ops.terminal });
  return actions;
}

export type ConversationChange = "rename" | "archive" | "pin";

export function conversationActions(chat: Conversation, archived: boolean, busy: boolean, ops: { rename: () => void; change: (action: Exclude<ConversationChange, "rename">) => void }): MenuAction[] {
  return [
    { id: "rename", label: "Rename…", onSelect: ops.rename, disabled: busy },
    { id: "pin", label: chat.pinned ? "Unpin conversation" : "Pin conversation", onSelect: () => ops.change("pin"), disabled: busy },
    { id: "archive", label: archived ? "Restore conversation" : "Archive conversation", onSelect: () => ops.change("archive"), disabled: busy },
  ];
}
