// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  running: false,
  liveSessions: [] as Array<{ id: string; session_key: string; title: string; status: string }>,
  getProfiles: vi.fn(async () => ({ profiles: [{ name: "frodo", is_default: true }, { name: "gandalf", is_default: false }] })),
  getSessions: vi.fn(async (_limit: number, _offset: number, profile: string) => ({ sessions: [{ id: profile === "gandalf" ? "gandalf-stored" : "stored", title: "Prior chat" }] })),
  getSessionMessages: vi.fn(async (_id: string, profile: string) => ({ messages: [{ role: "user", content: `Earlier from ${profile}` }] })),
  request: vi.fn(async (method: string, params?: { session_id?: string; profile?: string }) => {
    if (method === "session.list") return { sessions: [{ id: "stored", title: "Prior chat" }] };
    if (method === "session.active_list") return { sessions: mocks.liveSessions };
    if (method === "session.most_recent") return { session_id: "stored" };
    if (method === "session.resume") return { session_id: params?.session_id === "other-stored" ? "other-runtime" : "runtime", stored_session_id: params?.session_id, messages: [{ role: "user", text: `Earlier from ${params?.profile}` }], running: mocks.running };
    if (method === "session.create") return { session_id: "new-runtime", stored_session_id: "new-stored", messages: [] };
    if (method === "session.steer") return { status: "queued" };
    return {};
  }),
  events: new Set<(event: unknown) => void>(),
  requests: new Set<(request: unknown) => void>(),
}));
vi.mock("@/lib/api", () => ({ HERMES_BASE_PATH: "", api: { getProfiles: mocks.getProfiles, getSessions: mocks.getSessions, getSessionMessages: mocks.getSessionMessages } }));
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
vi.mock("./MobileKanban", () => ({ default: ({ taskId, onSelectTask }: { taskId?: string; onSelectTask: (id: string) => void }) => <div>{taskId ? `Task ${taskId}` : <button onClick={() => onSelectTask("t-1")}>Open task</button>}</div> }));
vi.mock("./MobileScreen", () => ({ default: ({ onContinue }: { onContinue: () => Promise<void> }) => <button onClick={() => void onContinue()}>Continue after hand back</button> }));
import MobileApp from "./MobileApp";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); mocks.getSessionMessages.mockImplementation(async (_id, profile) => ({ messages: [{ role: "user", content: `Earlier from ${profile}` }] })); mocks.running = false; mocks.liveSessions = []; window.history.replaceState({}, "", "/m"); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Element.prototype.scrollIntoView = vi.fn(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.events.clear(); mocks.requests.clear(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/m"); });
const renderApp = async () => { await act(async () => root.render(<BrowserRouter><MobileApp /></BrowserRouter>)); };
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

it.each(["another chat", "new conversation"])("keeps a foreign-session approval out of %s but answerable in its attributed inbox", async (mode) => {
  mocks.liveSessions = [
    { id: "runtime", session_key: "stored", title: "Current chat", status: "idle" },
    { id: "other-runtime", session_key: "other-stored", title: "Approval owner", status: "idle" },
  ];
  await renderApp();
  await settle(); await settle();
  await act(async () => (host.querySelector('.m-bot-row') as HTMLButtonElement).click());
  if (mode === "new conversation") {
    await act(async () => (host.querySelector('[aria-label="Back to bots"]') as HTMLButtonElement).click());
    await act(async () => (host.querySelector('[aria-label="New conversation with Frodo"]') as HTMLButtonElement).click());
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

it("shows readable assistant previews and keeps every home row in one list column", async () => {
  mocks.getSessionMessages.mockImplementation(async (_id, profile) => ({ messages: profile === "frodo"
    ? [{ role: "user", content: "work kanban task ta1e7d76a" }, { role: "assistant", content: "## Fixed **the layout** t_a1e7d76a" }]
    : [{ role: "assistant", content: "Window: 2026-09-26 00:00 to 2026-09-27" }] }));
  await renderApp(); await settle(); await settle();
  const rows = Array.from(host.querySelectorAll(".m-bot-row, .m-destination, .m-recent .m-list-row"));
  expect(rows.length).toBeGreaterThan(3);
  expect(rows.every(row => row.classList.contains("m-list-row") && !!row.querySelector(".m-list-leading + .m-list-copy"))).toBe(true);
  expect(rows[0].querySelector("small")?.textContent).toBe("Fixed the layout");
  expect(rows[1].querySelector("small")).toBeNull();
  expect(host.querySelector(".m-connection")).toBeNull();
  expect(host.querySelector('[aria-label="New conversation with Frodo"]')).not.toBeNull();
  expect(host.querySelector(".m-recent")?.textContent).not.toContain("New conversation");
});

it.each(["chat", "board", "board task", "screen"])("swipes back from %s in standalone mode with a following previous screen", async target => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  if (target === "screen") mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp(); await settle(); await settle();
  const button = target === "chat" ? host.querySelector(".m-bot-row") : Array.from(host.querySelectorAll(".m-destination")).find(row => row.textContent === (target.startsWith("board") ? "Board" : "Screen"));
  await act(async () => (button as HTMLButtonElement).click());
  if (target === "board task") await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Open task") as HTMLButtonElement).click());
  await settle();
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
    shell.dispatchEvent(event);
  };
  await act(async () => touch("touchstart", 10));
  expect(host.querySelector(".m-swipe-preview")?.textContent).toContain(target === "board task" ? "Board" : "Your bots");
  await act(async () => touch("touchmove", 190));
  await act(async () => { await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/translateX\(\d+(?:\.\d+)?px\)/)); });
  const duringGesture = (host.querySelector('.m-detail') as HTMLElement).style.transform;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toBe(duringGesture);
  await act(async () => { touch("touchend", 190); await vi.waitFor(() => expect(window.location.pathname).toBe(target === "board task" ? "/m/board" : "/m")); });
  if (target === "board task") {
    await vi.waitFor(() => {
      expect(host.querySelector('.m-swipe-preview')).toBeNull();
      expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/);
      expect(host.querySelector('.m-detail')?.textContent).toContain("Open task");
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/);
  }
});

it("slides a settled board task with the finger and leaves its board panel in view", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle();
  await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Board") as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Open task") as HTMLButtonElement).click());
  await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/));
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
    shell.dispatchEvent(event);
  };
  await act(async () => touch("touchstart", 10));
  await act(async () => touch("touchmove", 190));
  await act(async () => { await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toBe("translateX(180px)")); });
  await act(async () => { touch("touchend", 190); await vi.waitFor(() => expect(window.location.pathname).toBe("/m/board")); });
  expect(host.querySelector('.m-swipe-preview')).toBeNull();
  expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/);
  expect(host.querySelector('.m-detail')?.textContent).toContain("Open task");
});

it("returns the board task to its original position after cancelling an early edge swipe", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle();
  await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Board") as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Open task") as HTMLButtonElement).click());
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
    shell.dispatchEvent(event);
  };
  await act(async () => touch("touchstart", 10));
  await act(async () => touch("touchmove", 60));
  await act(async () => touch("touchend", 60));
  await act(async () => {
    await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/));
  });
  expect(host.querySelector('.m-swipe-preview')).toBeNull();
  expect(window.location.pathname).toBe("/m/board/t-1");
  expect(host.querySelector('.m-detail')?.textContent).toContain("Task t-1");
});

it("shows only data-loading placeholders on the first frame of a stored-chat deep link", async () => {
  window.history.replaceState({}, "", "/m/chat/frodo/stored");
  act(() => root.render(<BrowserRouter><MobileApp /></BrowserRouter>));
  expect(host.querySelector('.m-empty')).toBeNull();
  expect(host.querySelector('.m-messages .m-loading')).not.toBeNull();
  await settle();
});

it("opens a stored conversation from a deep link after reload", async () => {
  window.history.replaceState({}, "", "/m/chat/frodo/stored");
  await renderApp();
  await settle(); await settle();
  expect(host.querySelector('.m-home')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('.m-detail')?.textContent).toContain("Earlier");
});

it("prefetches both bots, pushes real URLs, and restores cached chat on browser back without resuming again", async () => {
  await renderApp();
  await settle(); await settle();
  expect(host.querySelectorAll('.m-bot-row small')).toHaveLength(2);
  expect(host.textContent).toContain("Earlier from gandalf");
  await act(async () => (Array.from(host.querySelectorAll('.m-bot-row')).find(row => row.textContent?.includes('Gandalf')) as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/gandalf/gandalf-stored');
  expect(host.querySelector('.m-messages')?.textContent).toContain('Earlier from gandalf');
  await settle();
  const resumes = mocks.request.mock.calls.filter(([method]) => method === 'session.resume').length;
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe('/m');
  await act(async () => { window.history.forward(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe('/m/chat/gandalf/gandalf-stored');
  expect(host.querySelector('.m-messages')?.textContent).toContain('Earlier from gandalf');
  expect(mocks.request.mock.calls.filter(([method]) => method === 'session.resume')).toHaveLength(resumes);
});

it("restores the bot list scroll after returning through browser history", async () => {
  await renderApp(); await settle(); await settle();
  const list = host.querySelector('.m-bot-list') as HTMLElement;
  await act(async () => { list.scrollTop = 140; list.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await act(async () => (host.querySelector('.m-bot-row') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(window.location.pathname).toContain('/m/chat/');
  expect(host.querySelector('.m-bot-list')).toBe(list);
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(host.querySelector('.m-bot-list')).toBe(list);
  expect(list.scrollTop).toBe(140);
});

it("switches stored conversations from the chat sheet and starts a new one without another backend session", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-bot-row') as HTMLButtonElement).click());
  await settle();
  const before = mocks.request.mock.calls.filter(([method]) => method === 'session.create').length;
  await act(async () => (host.querySelector('[aria-label="Conversations"]') as HTMLButtonElement).click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Prior chat');
  await act(async () => (host.querySelector('.m-conversation-list button') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/frodo/stored');
  await act(async () => (host.querySelector('[aria-label="New conversation"]') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/frodo/new');
  expect(host.querySelector('.m-detail')?.textContent).toContain('Start a conversation');
  expect(mocks.request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(before);
});

it("refreshes the bot preview when the newest message changes", async () => {
  await renderApp(); await settle(); await settle();
  const frodo = Array.from(host.querySelectorAll('.m-bot-row')).find(row => row.textContent?.includes('Frodo'))!;
  expect(frodo.querySelector('small')?.textContent).toContain('Earlier from frodo');
  mocks.getSessionMessages.mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '## Fresh **answer**' }] });
  await act(async () => { for (const handler of mocks.events) handler({ type: 'message.complete', session_id: 'runtime', payload: {} }); });
  await settle();
  expect(frodo.querySelector('small')?.textContent).toBe('Fresh answer');
});

it("board task has a deep-linkable URL and back returns to the board", async () => {
  await renderApp(); await settle();
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Board') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/board');
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Open task') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/board/t-1');
  expect(host.textContent).toContain('Task t-1');
  await act(async () => { (host.querySelector('[aria-label="Back to board"]') as HTMLButtonElement).click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe('/m/board');
});

it("resolves legacy notification links to the latest stored chat", async () => {
  window.history.replaceState({}, '', '/m?profile=frodo');
  await renderApp(); await settle(); await settle(); await settle();
  expect(window.location.pathname).toBe('/m/chat/frodo/stored');
  expect(host.querySelector('.m-messages')?.textContent).toContain('Earlier');
});

it("resumes a profile's stored session, streams its runtime id, stops the turn, and answers a pending approval", async () => {
  await renderApp();
  await settle(); await settle();
  expect(host.querySelector('.m-bot-list')).not.toBeNull();
  expect(mocks.request).not.toHaveBeenCalledWith("session.resume", expect.anything());
  await act(async () => (host.querySelector('.m-bot-row') as HTMLButtonElement).click());
  await settle();
  expect(mocks.request).toHaveBeenCalledWith("session.resume", { profile: "frodo", session_id: "stored", source: "mobile", close_on_disconnect: false });
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
  await renderApp();
  await settle(); await settle();
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Screen") as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Continue after hand back") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("prompt.submit", {
    profile: "samwise", session_id: "runtime", text: "I cleared the check; continue",
  });
  expect(host.textContent).toContain("Earlier");
  await vi.waitFor(() => expect(host.querySelectorAll('.m-detail')).toHaveLength(1));
  await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/));
  expect(host.querySelector('.m-detail .m-messages')?.textContent).toContain("Earlier");
});

it("steers the running Samwise turn instead of starting a second one", async () => {
  mocks.running = true;
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp();
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
  await renderApp();
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
