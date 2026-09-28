import type { ChatRow } from "./mobile-state";

export const HISTORY_PAGE_SIZE = 50;
export const historyPage = (offset = 0) => ({ limit: HISTORY_PAGE_SIZE, offset, order: "latest" as const, includeCompacted: true });

const same = (a: ChatRow, b: ChatRow) => a.role === b.role && a.text === b.text;

/** Tail pages are chronological; drop rows already received over the live socket. */
export function appendLive(tail: ChatRow[], live: ChatRow[]): ChatRow[] {
  const max = Math.min(tail.length, live.length);
  for (let n = max; n > 0; n--) {
    if (tail.slice(-n).every((row, i) => same(row, live[i]))) return [...tail, ...live.slice(n)];
  }
  return [...tail, ...live];
}

/** Offset is measured in raw DB rows; render overlap is possible after a new turn. */
export function prependOlder(older: ChatRow[], current: ChatRow[]): ChatRow[] {
  const max = Math.min(older.length, current.length);
  for (let n = max; n > 0; n--) {
    if (older.slice(-n).every((row, i) => same(row, current[i]))) return [...older.slice(0, -n), ...current];
  }
  return [...older, ...current];
}
