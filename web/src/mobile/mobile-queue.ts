export interface QueuedMessage { id: string; text: string; skills: string[] }
type Queues = Record<string, QueuedMessage[]>;
const KEY = "hermes-mobile-queue:v1";

export function readQueues(): Queues {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => Array.isArray(value) && value.every(entry => typeof entry?.id === "string" && typeof entry?.text === "string"))) as Queues;
  } catch { return {}; }
}
export function writeQueue(key: string, entries: QueuedMessage[]): Queues {
  const queues = readQueues();
  if (entries.length) queues[key] = entries;
  else delete queues[key];
  localStorage.setItem(KEY, JSON.stringify(queues));
  return queues;
}
export function queuedMessage(text: string, skills: string[]): QueuedMessage {
  return { id: crypto.randomUUID(), text, skills };
}
