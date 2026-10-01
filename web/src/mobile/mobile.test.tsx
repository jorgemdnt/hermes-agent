// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PromptCard from "./PromptCard";
import { applyChatEvent, transcriptRows, type MobileChat } from "./mobile-state";
import type { ServerRequest } from "@hermes/shared";

const chat: MobileChat = { runtimeId: "live", storedId: "stored", running: false, rows: [{ role: "user", text: "Hello" }], draft: "" };
const event = (type: string, session_id = "live", text = "") => ({ type, session_id, payload: { text } });

describe("mobile chat projection", () => {
  it("streams only the selected runtime session, seals the final text once, and excludes hidden transcript rows", () => {
    expect(applyChatEvent(chat, event("message.delta", "another", "Wrong") as never)).toBe(chat);
    const started = applyChatEvent(chat, event("message.start") as never);
    const streaming = applyChatEvent(started, event("message.delta", "live", "Partial") as never);
    const done = applyChatEvent(streaming, event("message.complete", "live", "Final") as never);
    expect(done).toMatchObject({ running: false, draft: "", rows: [{ text: "Hello" }, { text: "Final" }] });
    expect(transcriptRows([{ role: "user", text: "Yes" }, { role: "assistant", text: "Hidden", display_kind: "hidden" }, { role: "tool", text: "secret" }])).toEqual([{ role: "user", text: "Yes" }]);
  });
});

let host: HTMLDivElement;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });
function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function renderPrompt(method: string, params: Record<string, unknown>) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  const respond = vi.fn();
  const received = vi.fn();
  const request = { id: "srq-123", method, params, respond: vi.fn(), fail: vi.fn() } as ServerRequest;
  act(() => root.render(<PromptCard pending={{ profile: "frodo", request }} onAnswer={respond} onReceived={received} />));
  return { respond, received };
}

describe("mobile prompt answers", () => {
  it("acknowledges and answers approvals with the offered choice", () => {
    const { respond, received } = renderPrompt("approval", { session_id: "live", request_id: "req-123", command: "ls", choices: ["once", "deny"] });
    expect(received).toHaveBeenCalledWith("req-123");
    act(() => (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Allow once") as HTMLButtonElement).click());
    expect(respond).toHaveBeenCalledWith("srq-123", { choice: "once" });
  });

  it("submits a batch clarify as a question-id map", () => {
    const { respond } = renderPrompt("clarify", { session_id: "live", questions: [{ qid: "q1", question: "Which?", choices: ["A", "B"] }, { qid: "q2", question: "Why?" }] });
    act(() => (host.querySelector('input[type="radio"]') as HTMLInputElement).click());
    const input = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => setInputValue(input, "Because"));
    act(() => (host.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    expect(respond).toHaveBeenCalledWith("srq-123", { answers: { q1: "A", q2: "Because" } });
  });

  it("encodes vault login only in the direct response, not page text", () => {
    const { respond } = renderPrompt("vault.save_login", { session_id: "live", origin: "https://example.com", site: "Example" });
    const fields = Array.from(host.querySelectorAll("input"));
    act(() => { setInputValue(fields[0], "user"); setInputValue(fields[1], "canary"); });
    act(() => (host.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    expect(host.textContent).not.toContain("canary");
    expect(respond).toHaveBeenCalledWith("srq-123", { value: JSON.stringify({ identifier: "user", password: "canary" }) });
  });

  it("keeps the compact secret form useful without exposing storage or boilerplate", () => {
    const { respond } = renderPrompt("secret.request", {
      name: "GITHUB_PERSONAL_TOKEN", title: "GitHub token for jorgemdnt",
      reason: "So Samwise can push to your personal repos", requester: "Samwise",
      help_url: "https://github.com/settings/personal-access-tokens/new", hint: "Contents: read/write · 90 days",
      destination: { kind: "remote_file", path: "/home/hermes/.hermes/secrets/github-personal.env" },
    });
    expect(host.querySelector("h2")?.textContent).toBe("GitHub token for jorgemdnt");
    const link = host.querySelector("a")!;
    expect(link.href).toBe("https://github.com/settings/personal-access-tokens/new");
    expect(link.rel).toContain("noopener");
    const disclosure = host.querySelector("details")!;
    expect(disclosure.open).toBe(false);
    expect(disclosure.textContent).toContain("0600");
    expect(disclosure.textContent).toContain("not added to chat history");
    expect(host.textContent).not.toContain("Secret requested");
    const input = host.querySelector("input")!;
    expect(input.placeholder).toBe("Paste token");
    expect(input.getAttribute("aria-label")).toBe("GitHub token for jorgemdnt");
    act(() => setInputValue(input, "declined-canary"));
    act(() => (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Decline")!).click());
    expect(respond).toHaveBeenCalledWith("srq-123", { value: "" });
    expect(input.value).toBe("");
  });

  it.each(["secret.request", "secret"])("clips legacy %s copy but retains the full request in Details", method => {
    const reason = "A long legacy explanation with setup steps.\n" + "Keep the full instructions accessible. ".repeat(12);
    renderPrompt(method, { name: "GITHUB_PERSONAL_TOKEN", env_var: "GITHUB_PERSONAL_TOKEN", reason, prompt: reason, help_url: "javascript:alert(1)" });
    expect(host.querySelector("h2")?.textContent).toBe("GitHub personal token");
    const summary = host.querySelector(".m-secret-reason")!;
    expect(summary.textContent!.length).toBeLessThanOrEqual(80);
    expect(summary.textContent).not.toContain("\n");
    expect(host.querySelector("details")?.textContent).toContain(reason);
    expect(host.querySelector("a")).toBeNull();
  });

  it("shows the server-bound destination and keeps the secret out of page text", () => {
    const { respond } = renderPrompt("secret.request", {
      session_id: "live", name: "CANARY_TOKEN", reason: "test flow", requester: "Frodo",
      destination: { kind: "env_file", path: "~/.hermes/canary.env" }, expires_at: Date.now() / 1000 + 180,
    });
    expect(host.textContent).toContain("~/.hermes/canary.env");
    expect(host.textContent).toContain("test flow");
    expect(host.textContent).toContain("0600");
    const input = host.querySelector('input[type="password"]') as HTMLInputElement;
    act(() => setInputValue(input, "test_canary"));
    act(() => (host.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    expect(host.textContent).not.toContain("test_canary");
    expect(respond).toHaveBeenCalledWith("srq-123", { value: "test_canary" });
  });
});
