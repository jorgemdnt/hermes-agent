import type { GatewayEvent, ServerRequest } from "@hermes/shared";

export interface ChatRow {
  role: string;
  text: string;
}

export interface MobileChat {
  rows: ChatRow[];
  draft: string;
  running: boolean;
  runtimeId: string;
  storedId: string;
}

export interface PendingPrompt {
  request: ServerRequest;
  profile: string;
}

export const PROMPT_METHODS = new Set([
  "approval", "clarify", "sudo", "secret", "secret.request", "vault.unlock_prompt", "vault.save_login", "vault.code",
]);

export function transcriptRows(messages: Array<{ role: string; text?: string | null; display_kind?: string | null }>): ChatRow[] {
  return messages.filter(m => (m.role === "user" || m.role === "assistant") && m.display_kind !== "hidden" && !!m.text)
    .map(m => ({ role: m.role, text: m.text! }));
}

export function applyChatEvent(chat: MobileChat, event: GatewayEvent): MobileChat {
  if (event.session_id !== chat.runtimeId) return chat;
  const payload = event.payload as { text?: unknown; status?: string } | undefined;
  switch (event.type) {
    case "message.start":
      return { ...chat, running: true, draft: "" };
    case "message.delta":
      return { ...chat, running: true, draft: chat.draft + (typeof payload?.text === "string" ? payload.text : "") };
    case "message.interim":
      return typeof payload?.text === "string" && payload.text
        ? { ...chat, draft: "", rows: [...chat.rows, { role: "assistant", text: payload.text }] }
        : chat;
    case "message.complete": {
      const text = typeof payload?.text === "string" ? payload.text : chat.draft;
      return { ...chat, running: false, draft: "", rows: text ? [...chat.rows, { role: "assistant", text }] : chat.rows };
    }
    default:
      return chat;
  }
}
