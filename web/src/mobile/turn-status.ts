import type { SessionMessage } from "@/lib/api";

export function unansweredTurn(messages: SessionMessage[]): boolean {
  const user = messages.findLastIndex(message => message.role === "user");
  return user >= 0 && !messages.slice(user + 1).some(message =>
    message.role === "assistant" && !message.tool_calls?.length && !!message.content?.trim());
}
