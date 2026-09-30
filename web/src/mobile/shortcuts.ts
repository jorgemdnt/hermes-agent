export type ShortcutAction =
  | { kind: "nth"; index: number }
  | { kind: "tab"; tab: "bots" | "chats" }
  | { kind: "sidebar"; side: "left" | "right" }
  | { kind: "archive" | "previous" | "next" | "new" | "search" | "unread" | "help" };

/** Maps a keydown to a shortcut. Cmd and Ctrl are interchangeable: browsers own some Cmd chords, hermetic's native menu forwards Ctrl. */
export function parseShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { code?: string },
  isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac"),
): ShortcutAction | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = event.key.toLowerCase();
  // Option+B reports ∫ on macOS; use the physical key for this chord.
  if (!event.shiftKey && (key === "b" || event.code === "KeyB")) return { kind: "sidebar", side: event.altKey ? "right" : "left" };
  if (event.altKey) return null;
  // On a Mac, Ctrl is free: Ctrl+1 / Ctrl+2 flip the Bots | Chats switch, Cmd+1-9 opens list items.
  if (isMac && event.ctrlKey && !event.metaKey && !event.shiftKey && (key === "1" || key === "2")) {
    return { kind: "tab", tab: key === "1" ? "bots" : "chats" };
  }
  if (event.shiftKey) {
    if (key === "a") return { kind: "archive" };
    if (key === "u") return { kind: "unread" };
    return null;
  }
  if (/^[1-9]$/.test(key)) return { kind: "nth", index: Number(key) - 1 };
  const plain = ({ "[": "previous", "]": "next", n: "new", k: "search", "/": "help" } as const)[key as "["];
  return plain ? { kind: plain } : null;
}

export const SHORTCUT_HELP: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "⌃1  ⌃2", label: "Switch to Bots / Chats" },
  { keys: "⌘1–9", label: "Open the Nth bot or conversation in the list" },
  { keys: "⌘[  ⌘]", label: "Back / forward in navigation history" },
  { keys: "⌘N", label: "New conversation with this bot" },
  { keys: "⌘K", label: "Search" },
  { keys: "⌘⇧A", label: "Archive conversation (undo in the toast)" },
  { keys: "⌘⇧U", label: "Mark conversation unread" },
  { keys: "⌘B", label: "Toggle left sidebar" },
  { keys: "⌘⌥B", label: "Toggle right sidebar" },
  { keys: "⌘J", label: "Toggle terminal" },
  { keys: "⌘\\", label: "Toggle right split" },
  { keys: "⌘/", label: "This help" },
];
