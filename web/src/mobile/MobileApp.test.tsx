// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  running: false,
  liveSessions: [] as Array<{ id: string; session_key: string; title: string; status: string }>,
  getProfiles: vi.fn(async () => ({ profiles: [{ name: "frodo", is_default: true }, { name: "gandalf", is_default: false }] })),
  request: vi.fn(async (method: string, params?: { session_id?: string }) => {
    if (method === "session.list") return { sessions: [{ id: "stored", title: "Prior chat" }] };
    if (method === "session.active_list") return { sessions: mocks.liveSessions };
    if (method === "session.most_recent") return { session_id: "stored" };
    if (method === "session.resume") return { session_id: params?.session_id === "other-stored" ? "other-runtime" : "runtime", stored_session_id: params?.session_id, messages: [{ role: "user", text: "Earlier" }], running: mocks.running };
    if (method === "session.create") return { session_id: "new-runtime", stored_session_id: "new-stored", messages: [] };
    if (method === "session.steer") return { status: "queued" };
    return {};
  }),
  events: new Set<(event: unknown) => void>(),
  requests: new Set<(request: unknown) => void>(),
}));
vi.mock("@/lib/api", () => ({ HERMES_BASE_PATH: "", api: { getProfiles: mocks.getProfiles } }));
vi.mock("@/lib/gatewayClient", () => ({ GatewayClient: class {
  connectionState = "idle";
  onState(handler: (state: string) => void) { handler("idle"); this.stateHandler = handler; return () => {}; }
  stateHandler: (state: string) => void = () => {};
  onEvent(handler: (event: unknown) => void) { mocks.events.add(handler); return () => { mocks.events.delete(handler); }; }
  onRequest(handler: (request: unknown) => void) { mocks.requests.add(handler); return () => { mocks.requests.delete(handler); }; }
  async connect() { this.connectionState = "open"; this.stateHandler("open"); }
  request = mocks.request;
  close() { this.connectionState = "closed"; }
} }));
vi.mock("./mobile-push", () => ({ pushAvailable: () => false, registerMobileWorker: vi.fn(), subscribePush: vi.fn(), unsubscribePush: vi.fn(), localSignOut: vi.fn() }));
vi.mock("./MobileKanban", () => ({ default: () => <div>Board</div> }));
vi.mock("./MobileScreen", () => ({ default: ({ onContinue }: { onContinue: () => Promise<void> }) => <button onClick={() => void onContinue()}>Continue after hand back</button> }));
import MobileApp from "./MobileApp";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); mocks.running = false; mocks.liveSessions = []; vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Element.prototype.scrollIntoView = vi.fn(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.events.clear(); mocks.requests.clear(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

it.each(["another chat", "new conversation"])("keeps a foreign-session approval out of %s but answerable in its attributed inbox", async (mode) => {
  mocks.liveSessions = [
    { id: "runtime", session_key: "stored", title: "Current chat", status: "idle" },
    { id: "other-runtime", session_key: "other-stored", title: "Approval owner", status: "idle" },
  ];
  await act(async () => root.render(<MobileApp />));
  await settle(); await settle();
  await act(async () => (host.querySelector('.m-bot-row') as HTMLButtonElement).click());
  if (mode === "new conversation") {
    await act(async () => (host.querySelector('[aria-label="Back to bots"]') as HTMLButtonElement).click());
    await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "New conversation") as HTMLButtonElement).click());
  }
  const respond = vi.fn();
  await act(async () => { for (const handler of mocks.requests) handler({ id: "srq-other", method: "approval", params: { session_id: "other-runtime", request_id: "ap-other", choices: ["once", "deny"], command: "test foreign" }, respond, fail: vi.fn() }); });
  await settle();
  expect(host.querySelector('.m-messages')?.textContent).not.toContain("test foreign");
  expect(host.querySelector('.m-messages')?.textContent).toContain("View requests");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("View requests")) as HTMLButtonElement).click());
  expect(host.querySelector('.m-inbox')?.textContent).toContain("Approval owner · other-runtime");
  expect(host.querySelector('.m-inbox')?.textContent).toContain("test foreign");
  await act(async () => (host.querySelector('.m-inbox button') as HTMLButtonElement).click());
  await settle();
  expect(mocks.request).toHaveBeenCalledWith("session.resume", { profile: "frodo", session_id: "other-stored", source: "mobile", close_on_disconnect: false });
  expect(host.querySelector('.m-messages')?.textContent).toContain("test foreign");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Allow once") as HTMLButtonElement).click());
  expect(respond).toHaveBeenCalledWith({ choice: "once" });
});

it("opens a bot chat from a notification deep link", async () => {
  window.history.replaceState({}, "", "/m?profile=frodo");
  await act(async () => root.render(<MobileApp />));
  await settle(); await settle();
  expect(host.querySelector('.m-bot-list')).toBeNull();
  expect(host.textContent).toContain("Earlier");
});

it("resumes a profile's stored session, streams its runtime id, stops the turn, and answers a pending approval", async () => {
  await act(async () => root.render(<MobileApp />));
  await settle(); await settle();
  expect(mocks.request).toHaveBeenCalledWith("session.resume", { profile: "frodo", session_id: "stored", source: "mobile", close_on_disconnect: false });
  expect(host.querySelector('.m-bot-list')).not.toBeNull();
  await act(async () => (host.querySelector('.m-bot-row') as HTMLButtonElement).click());
  expect(host.querySelector('.m-nav')).toBeNull();
  expect(host.textContent).toContain("Earlier");
  await act(async () => { for (const handler of mocks.events) handler({ type: "message.delta", session_id: "runtime", payload: { text: "Streaming" } }); });
  expect(host.textContent).toContain("Streaming");
  await act(async () => (host.querySelector('.m-avatar-button') as HTMLButtonElement).click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Frodo activity");
  await act(async () => (host.querySelector('[aria-label="Close activity"]') as HTMLButtonElement).click());
  const respond = vi.fn();
  await act(async () => { for (const handler of mocks.requests) handler({ id: "srq-1", method: "approval", params: { session_id: "runtime", request_id: "ap-1", choices: ["once", "deny"], command: "ls" }, respond, fail: vi.fn() }); });
  expect(host.textContent).toContain("Approve command?");
  expect(host.querySelector('.m-inline-request')).not.toBeNull();
  expect(host.querySelector('.m-prompt-overlay')).toBeNull();
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Allow once") as HTMLButtonElement).click());
  expect(respond).toHaveBeenCalledWith({ choice: "once" });
  await act(async () => (host.querySelector('button[aria-label="Stop"]') as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.interrupt", { profile: "frodo", session_id: "runtime" });
});

it("sends Continue to Samwise's selected chat after a screen hand-back", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await act(async () => root.render(<MobileApp />));
  await settle(); await settle();
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Screen") as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Continue after hand back") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("prompt.submit", {
    profile: "samwise", session_id: "runtime", text: "I cleared the check; continue",
  });
  expect(host.textContent).toContain("Earlier");
});

it("steers the running Samwise turn instead of starting a second one", async () => {
  mocks.running = true;
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await act(async () => root.render(<MobileApp />));
  await settle(); await settle();
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Screen") as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Continue after hand back") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.steer", {
    profile: "samwise", session_id: "runtime", text: "I cleared the check; continue",
  });
  expect(mocks.request).not.toHaveBeenCalledWith("prompt.submit", expect.anything());
});

it("submits Continue to the same chat when a running turn finishes before steer", async () => {
  mocks.running = true;
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await act(async () => root.render(<MobileApp />));
  await settle(); await settle();
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Screen") as HTMLButtonElement).click());
  mocks.request.mockImplementationOnce(async () => ({ status: "rejected" }));
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Continue after hand back") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.steer", {
    profile: "samwise", session_id: "runtime", text: "I cleared the check; continue",
  });
  expect(mocks.request).toHaveBeenCalledWith("prompt.submit", {
    profile: "samwise", session_id: "runtime", text: "I cleared the check; continue",
  });
  expect(host.textContent).toContain("Earlier");
});
