import type { ChatRow } from "./mobile-state";

// A "user" row in a bot's chat is not always the human. Other bots, cron jobs,
// background processes and Hermes itself deliver into the same role. Mirrors the
// desktop's AGENT_MESSAGE_RE / PROCESS_NOTIFICATION_RE so both surfaces agree.
export type MessageKind =
  | { kind: "human"; text: string }
  | { kind: "agent"; sender: string; handle: string; body: string }
  | { kind: "system"; label: string; body: string };

const AGENT_MESSAGE_RE =
  /^(?:Message from (?:🤖\s*)?([^:\n(]{1,64}?)(?:\s*\(@([a-z0-9][a-z0-9_-]{0,63})(?:@[a-zA-Z0-9][a-zA-Z0-9_-]{0,63})?\))?:\s*|\[Message from agent '([^']{1,64})'\]\s*)([\s\S]*)$/u;
const PROCESS_RE = /^\[IMPORTANT: Background process ([\s\S]*)\]$/;
const CRON_RE = /^\[Cronjob "([^"]+)" output[^\]]*\]\s*([\s\S]*)$/;
const SYSTEM_RE = /^\[System: ([\s\S]*?)\]\s*$/;

export function classifyUserText(raw: string): MessageKind {
  const text = raw.trim();
  const agent = AGENT_MESSAGE_RE.exec(text);
  if (agent) {
    const sender = (agent[1] || agent[3] || "agent").trim();
    return { kind: "agent", sender, handle: (agent[2] || agent[3] || sender).trim().toLowerCase(), body: agent[4].trim() };
  }
  const cron = CRON_RE.exec(text);
  if (cron) return { kind: "system", label: `Scheduled job: ${cron[1]}`, body: cron[2].trim() };
  const proc = PROCESS_RE.exec(text);
  if (proc) {
    const head = proc[1].split("\n", 1)[0];
    const label = /(?:exit code (?!0\b)\d+|failed|error)/i.test(head) ? "Background task failed"
      : /(?:completed normally|exit code 0|finished successfully)/i.test(head) ? "Background task finished" : "Background task update";
    return { kind: "system", label, body: `Background process ${proc[1].trim()}` };
  }
  const sys = SYSTEM_RE.exec(text);
  if (sys) return { kind: "system", label: "System notice", body: sys[1].trim() };
  return { kind: "human", text: raw };
}

export function groupNoticeRows(rows: ChatRow[]): ChatRow[][] {
  const groups: ChatRow[][] = [];
  for (const row of rows) {
    const isNotice = row.role === "user" && classifyUserText(row.text).kind !== "human";
    const last = groups.at(-1);
    if (isNotice && last?.[0].role === "user" && classifyUserText(last[0].text).kind !== "human") last.push(row);
    else groups.push([row]);
  }
  return groups;
}
