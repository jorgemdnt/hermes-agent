export type ShortcutAction =
  | { kind: "nth"; index: number }
  | { kind: "archive" | "previous" | "next" | "new" | "search" | "unread" | "help" };

/** Maps a keydown to a shortcut. Cmd and Ctrl are interchangeable: browsers own some Cmd chords, hermetic's native menu forwards Ctrl. */
export function parseShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): ShortcutAction | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
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
  { keys: "⌘1–9", label: "Open the Nth bot or conversation in the list" },
  { keys: "⌘[  ⌘]", label: "Previous / next conversation" },
  { keys: "⌘N", label: "New conversation with this bot" },
  { keys: "⌘K", label: "Search" },
  { keys: "⌘⇧A", label: "Archive conversation (undo in the toast)" },
  { keys: "⌘⇧U", label: "Mark conversation unread" },
  { keys: "⌘J", label: "Toggle terminal" },
  { keys: "⌘/", label: "This help" },
];
