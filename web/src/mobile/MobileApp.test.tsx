// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  running: false,
  liveSessions: [] as Array<{ id: string; session_key: string; title: string; status: string }>,
  waitingProfile: "",
  rosterPreview: {} as Record<string, string>,
  rosterAbsent: "",
  existingCanonical: "",
  getProfiles: vi.fn(async () => ({ profiles: [{ name: "frodo", is_default: true }, { name: "gandalf", is_default: false }] })),
  getAllProfileSessions: vi.fn(async (): Promise<{ sessions: Array<{ id: string; profile: string; title: string; preview: string; last_active: number; message_count: number; pinned?: boolean }> }> => ({ sessions: [
    { id: "side-frodo", profile: "frodo", title: "Prior chat", preview: "Earlier from frodo", last_active: 20, message_count: 2 },
    { id: "gandalf-found", profile: "gandalf", title: "Found chat", preview: "Match in message", last_active: 10, message_count: 2 },
  ] })),
  getSessionMessages: vi.fn(async (_id: string, profile: string, _page?: { offset?: number }) => ({ messages: [{ role: "user", content: `Earlier from ${profile}` }] })),
  searchSessions: vi.fn(async (_query: string, profile: string) => ({ results: profile === "gandalf" ? [{ session_id: "gandalf-found", title: "Found chat", snippet: "Match in message", last_active: 10 }] : [] })),
  request: vi.fn(async (method: string, params?: { session_id?: string; profile?: string }) => {
    if (method === "profiles.list") return { profiles: ["frodo", "gandalf", "samwise", "author", "default", "gimli"].map(name => ({ name, canonical_session: name === mocks.rosterAbsent ? null : {
      id: name === "gandalf" ? "gandalf-stored" : "stored", resolved_id: name === "gandalf" ? "gandalf-stored" : "stored",
      preview: mocks.rosterPreview[name] || `Earlier from ${name}`, last_active: 50,
    } })) };
    if (method === "session.list") return { sessions: params?.profile === mocks.existingCanonical ? [{ id: "already-stored", resolved_id: "already-current" }] : [] };
    if (method === "session.active_list") return { sessions: mocks.waitingProfile && params?.profile !== mocks.waitingProfile ? [] : mocks.liveSessions };
    if (method === "session.resume") return { session_id: params?.session_id === "other-stored" ? "other-runtime" : "runtime", stored_session_id: params?.session_id, messages: [{ role: "user", text: `Earlier from ${params?.profile}` }], running: mocks.running };
    if (method === "session.create") return { session_id: "new-runtime", stored_session_id: "new-stored", messages: [] };
    if (method === "session.steer") return { status: "queued" };
    return {};
  }),
  events: new Set<(event: unknown) => void>(),
  requests: new Set<(request: unknown) => void>(),
}));
vi.mock("@/lib/api", () => ({ HERMES_BASE_PATH: "", api: { getProfiles: mocks.getProfiles, getAllProfileSessions: mocks.getAllProfileSessions, getSessionMessages: mocks.getSessionMessages, searchSessions: mocks.searchSessions } }));
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
import { PIN_STORAGE_KEY } from "./home-data";

let root: Root;
let host: HTMLDivElement;
const storage = new Map<string, string>();
beforeEach(() => { storage.clear(); vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } }); vi.clearAllMocks(); mocks.getAllProfileSessions.mockResolvedValue({ sessions: [
  { id: "side-frodo", profile: "frodo", title: "Prior chat", preview: "Earlier from frodo", last_active: 20, message_count: 2 },
  { id: "gandalf-found", profile: "gandalf", title: "Found chat", preview: "Match in message", last_active: 10, message_count: 2 },
] }); mocks.getSessionMessages.mockImplementation(async (_id, profile) => ({ messages: [{ role: "user", content: `Earlier from ${profile}` }] })); mocks.running = false; mocks.liveSessions = []; mocks.waitingProfile = ""; mocks.rosterPreview = {}; mocks.rosterAbsent = ""; mocks.existingCanonical = ""; window.history.replaceState({}, "", "/m"); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Element.prototype.scrollIntoView = vi.fn(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.events.clear(); mocks.requests.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/m"); });
const renderApp = async () => { await act(async () => root.render(<BrowserRouter><MobileApp /></BrowserRouter>)); };
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

const openDestination = async (label: string) => {
  await act(async () => (host.querySelector('[aria-label="Profile menu"]') as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll('.m-home-menu a')).find(link => link.textContent === label) as HTMLAnchorElement).click());
};

it.each(["another chat", "new conversation"])("keeps a foreign-session approval out of %s but answerable in its attributed inbox", async (mode) => {
  mocks.liveSessions = [
    { id: "runtime", session_key: "stored", title: "Current chat", status: "idle" },
    { id: "other-runtime", session_key: "other-stored", title: "Approval owner", status: "idle" },
  ];
  await renderApp();
  await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  if (mode === "new conversation") {
    await act(async () => (host.querySelector('[aria-label="Back to bots"]') as HTMLButtonElement).click());
    await act(async () => (host.querySelector('.m-home [aria-label="New conversation"]') as HTMLButtonElement).click());
    await act(async () => (host.querySelector('.m-bot-picker button') as HTMLButtonElement).click());
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
  expect(mocks.request).toHaveBeenCalledWith("session.resume", { profile: "frodo", session_id: "other-stored", source: "mobile", close_on_disconnect: false, omit_messages: true, defer_history: true });
  expect(host.querySelector('.m-messages')?.textContent).toContain("test foreign");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Allow once") as HTMLButtonElement).click());
  expect(respond).toHaveBeenCalledWith({ choice: "once" });
});

it("shows pinned bots above one recency list with real message previews", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "gandalf", is_default: false }, { name: "author", is_default: false }] });
  mocks.getSessionMessages.mockImplementation(async (_id, profile) => ({ messages: profile === "author"
    ? [{ role: "user", content: "work kanban task ta1e7d76a" }, { role: "assistant", content: "## Fixed **the layout** t_a1e7d76a" }]
    : [{ role: "assistant", content: `Earlier from ${profile}` }] }));
  await renderApp(); await settle(); await settle();
  expect(Array.from(host.querySelectorAll(".m-pinned-bot > span:last-of-type")).map(row => row.textContent)).toEqual(["Frodo", "Gandalf"]);
  expect(host.querySelector(".m-bot-row .m-bot-copy small")?.textContent).toBe("Fixed the layout");
  expect(host.querySelector(".m-recent")).toBeNull();
  expect(host.querySelector(".m-destination")).toBeNull();
  expect(host.querySelector(".m-list-header h1")?.className).toBe("sr-only");
  expect(host.querySelector('[aria-label="New conversation"]')).not.toBeNull();
});

it.each(["chat", "board", "board task", "screen"])("swipes back from %s in standalone mode with a following previous screen", async target => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  if (target === "screen") mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp(); await settle(); await settle();
  if (target === "chat") await act(async () => (host.querySelector(".m-pinned-bot") as HTMLButtonElement).click());
  else await openDestination(target.startsWith("board") ? "Board" : "Screen");
  if (target === "board task") await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Open task") as HTMLButtonElement).click());
  await settle();
  const index = window.history.state.idx as number;
  const back = vi.spyOn(window.history, "back");
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
    shell.dispatchEvent(event);
  };
  await act(async () => touch("touchstart", 10));
  expect(host.querySelector(".m-swipe-preview")?.textContent).toContain(target === "board task" ? "Board" : "Frodo");
  await act(async () => touch("touchmove", 190));
  await act(async () => { await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/translateX\(\d+(?:\.\d+)?px\)/)); });
  const duringGesture = (host.querySelector('.m-detail') as HTMLElement).style.transform;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toBe(duringGesture);
  await act(async () => { touch("touchend", 190); await vi.waitFor(() => expect(window.location.pathname).toBe(target === "board task" ? "/m/board" : "/m")); });
  expect(back).toHaveBeenCalledTimes(1);
  expect(window.history.state.idx).toBe(index - 1);
  if (target !== "board task") {
    expect((host.querySelector('.m-home') as HTMLElement).style.transform).toBe("");
    expect(host.querySelector('.m-swipe-preview')).toBeNull();
  }
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

const edgeTouch = (shell: HTMLElement, type: string, x: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
  shell.dispatchEvent(event);
  return event;
};

it("lets iOS standalone own the edge swipe: one native history step and no app slide", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)");
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle();
  await act(async () => (host.querySelector(".m-pinned-bot") as HTMLButtonElement).click());
  await settle();
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const back = vi.spyOn(window.history, "back");
  window.addEventListener("popstate", event => Object.defineProperty(event, "hasUAVisualTransition", { value: true }), { once: true, capture: true });
  await act(async () => { edgeTouch(shell, "touchstart", 10); expect(edgeTouch(shell, "touchmove", 190).defaultPrevented).toBe(false); edgeTouch(shell, "touchend", 190); });
  expect(host.querySelector(".m-swipe-preview")).toBeNull();
  expect((host.querySelector(".m-detail") as HTMLElement).style.transform).not.toMatch(/translateX\(\d{2,}px\)/);
  expect(window.location.pathname).toContain("/m/chat/");
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(back).toHaveBeenCalledTimes(1); // The only back call belongs to the simulated OS gesture.
  expect(window.location.pathname).toBe("/m");
  expect(host.querySelectorAll(".m-detail")).toHaveLength(0);
});

it.each([true, false])("skips the app exit only when popstate has a UA visual transition (%s)", async uaTransition => {
  window.addEventListener("popstate", event => Object.defineProperty(event, "hasUAVisualTransition", { value: uaTransition }), { once: true, capture: true });
  await renderApp(); await settle();
  await act(async () => (host.querySelector(".m-pinned-bot") as HTMLButtonElement).click());
  await settle();
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe("/m");
  expect(host.querySelectorAll(".m-detail").length).toBe(uaTransition ? 0 : 1);
});

it("uses an iOS edge touch as the fallback for an unmarked native popstate", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X)");
  await renderApp(); await settle();
  await act(async () => (host.querySelector(".m-pinned-bot") as HTMLButtonElement).click());
  await settle();
  const shell = host.querySelector(".m-shell") as HTMLElement;
  await act(async () => { edgeTouch(shell, "touchstart", 10); edgeTouch(shell, "touchmove", 190); edgeTouch(shell, "touchend", 190); });
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe("/m");
  expect(host.querySelectorAll(".m-detail")).toHaveLength(0);
});

it("slides a settled board task with the finger and leaves its board panel in view", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle();
  await openDestination("Board");
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
  await openDestination("Board");
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

it("hydrates fifty recent messages and prepends older pages without moving the visible row", async () => {
  mocks.getSessionMessages.mockImplementation(async (_id, _profile, page) => {
    const start = page?.offset === 50 ? 0 : 50;
    return { messages: Array.from({ length: 50 }, (_, index) => ({ role: "user", content: `Message ${start + index}` })),
      pagination: { limit: 50, offset: page?.offset ?? 0, order: "latest" as const, returned: 50 } };
  });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const log = host.querySelector('.m-messages') as HTMLElement;
  expect(log.querySelectorAll('.m-message')).toHaveLength(50);
  expect(log.textContent).not.toContain('Message 0');
  Object.defineProperty(log, 'scrollHeight', { get: () => log.querySelectorAll('.m-message').length * 100 });
  await act(async () => { log.scrollTop = 40; log.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await settle();
  expect(mocks.getSessionMessages).toHaveBeenCalledWith('stored', 'frodo', { limit: 50, offset: 50, order: 'latest', includeCompacted: true });
  expect(log.querySelectorAll('.m-message')).toHaveLength(100);
  expect(log.querySelector('.m-message')?.textContent).toContain('Message 0');
  expect(log.scrollTop).toBe(5040);
});

it("prefetches both bots, pushes real URLs, and restores cached chat on browser back without resuming again", async () => {
  await renderApp();
  await settle(); await settle();
  expect(mocks.getSessionMessages).toHaveBeenCalledWith('stored', 'frodo', { limit: 50, offset: 0, order: 'latest', includeCompacted: true });
  expect(mocks.getSessionMessages).toHaveBeenCalledWith('gandalf-stored', 'gandalf', { limit: 50, offset: 0, order: 'latest', includeCompacted: true });
  expect(mocks.getAllProfileSessions).toHaveBeenCalled();
  expect(host.textContent).toContain("Gandalf");
  await act(async () => (Array.from(host.querySelectorAll('.m-pinned-bot')).find(row => row.textContent?.includes('Gandalf')) as HTMLButtonElement).click());
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
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(window.location.pathname).toContain('/m/chat/');
  expect(host.querySelector('.m-bot-list')).toBe(list);
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(host.querySelector('.m-bot-list')).toBe(list);
  expect(list.scrollTop).toBe(140);
});

it("opens the canonical Bot Chat, not a newer side conversation, and previews that same row", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "author", is_default: false }] });
  mocks.rosterPreview.author = "## Canonical **reply**";
  mocks.getAllProfileSessions.mockResolvedValue({ sessions: [
    { id: "newer-author-side", profile: "author", title: "Research", preview: "Unrelated side conversation", last_active: 999, message_count: 2 },
  ] });
  mocks.getSessionMessages.mockImplementation(async (_id, profile) => ({ messages: [{ role: "assistant", content: profile === "author" ? "Canonical reply" : "Earlier from frodo" }] }));
  await renderApp(); await settle(); await settle();
  expect(host.querySelector('.m-bot-row small')?.textContent).toBe("Canonical reply");
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/author/stored');
  expect(mocks.request).toHaveBeenCalledWith("profiles.list", { include_sessions: true });
  expect(mocks.request).not.toHaveBeenCalledWith("session.most_recent", expect.anything());
  await act(async () => (host.querySelector('[aria-label="Conversations"]') as HTMLButtonElement).click());
  expect(host.querySelector('.m-conversation-list')?.textContent).toContain('Research');
  expect(host.querySelector('.m-conversation-list')?.textContent).not.toContain('Bot Chat');
  await act(async () => (host.querySelector('.m-conversation-list button') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/author/newer-author-side');
});

it("creates the first canonical chat hidden and titled without adopting an unrelated recent session", async () => {
  mocks.rosterAbsent = "author";
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "author", is_default: false }] });
  await renderApp(); await settle();
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.list", { profile: "author", title: "Bot Chat", include_hidden: true });
  expect(mocks.request).toHaveBeenCalledWith("session.create", { profile: "author", source: "mobile", title: "Bot Chat", hidden: true, follow_profile_config: true, close_on_disconnect: false });
  expect(mocks.request).toHaveBeenCalledWith("session.title", { session_id: "new-runtime", title: "Bot Chat" });
  expect(window.location.pathname).toBe('/m/chat/author/new-stored');
});

it("adopts an existing titled Bot Chat when the roster has no canonical row yet", async () => {
  mocks.rosterAbsent = "author";
  mocks.existingCanonical = "author";
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "author", is_default: false }] });
  await renderApp(); await settle();
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/author/already-current');
  expect(mocks.request).not.toHaveBeenCalledWith("session.create", expect.anything());
});

it("switches stored conversations from the chat sheet and starts a new one without another backend session", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const before = mocks.request.mock.calls.filter(([method]) => method === 'session.create').length;
  await act(async () => (host.querySelector('[aria-label="Conversations"]') as HTMLButtonElement).click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Prior chat');
  await act(async () => (host.querySelector('.m-conversation-list button') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/frodo/side-frodo');
  await act(async () => (host.querySelector('.m-detail [aria-label="New conversation"]') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/frodo/new');
  expect(host.querySelector('.m-detail')?.textContent).toContain('Start a conversation');
  expect(mocks.request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(before);
});

it("lists pinned cross-profile side chats first with desktop titles in the switcher and search", async () => {
  mocks.getAllProfileSessions.mockResolvedValue({ sessions: [
    { id: "new-default", profile: "frodo", title: "Recent draft", preview: "first", last_active: 100, message_count: 3 },
    { id: "old-gandalf", profile: "gandalf", title: "Long-lived project", preview: "second", last_active: 1, pinned: true, message_count: 3 },
    { id: "hidden", profile: "gandalf", title: "Bot Chat", preview: "private", last_active: 90, message_count: 3 },
  ] });
  await renderApp(); await settle();
  await act(async () => (host.querySelector('[aria-label="Search"]') as HTMLButtonElement).click());
  const input = host.querySelector('[aria-label="Search bots and conversations"]') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'project'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  expect(input.value).toBe('project');
  expect(host.querySelector('.m-search-results')?.textContent).toContain('Long-lived project');
  expect(host.querySelectorAll('.m-search-result')).toHaveLength(1);
  await act(async () => (host.querySelector('[aria-label="Close search"]') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('[aria-label="Conversations"]') as HTMLButtonElement).click());
  expect([...host.querySelectorAll('.m-conversation-list strong')].map(x => x.textContent)).toEqual(['Long-lived project', 'Recent draft']);
  await act(async () => (host.querySelector('.m-conversation-list button') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/gandalf/old-gandalf');
});

it("shows only the three default pins with Jorge's five real profile names", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: ["gimli", "samwise", "gandalf", "default", "author"].map(name => ({ name, is_default: name === "default" })) });
  await renderApp(); await settle(); await settle();
  expect(Array.from(host.querySelectorAll(".m-pinned-bot > span:last-of-type")).map(label => label.textContent)).toEqual(["Frodo", "Gandalf", "Samwise"]);
  expect(Array.from(host.querySelectorAll(".m-bot-main .m-bot-heading strong")).map(label => label.textContent)).toEqual(["Author", "Gimli"]);
  expect(host.querySelectorAll(".m-pinned-bot, .m-bot-main")).toHaveLength(5);
  expect(host.querySelector(".m-row-action, .m-pin-action")).toBeNull();
});

it("refreshes the bot preview when the newest message changes", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  await act(async () => (host.querySelector('.m-pin-choice') as HTMLButtonElement).click());
  const frodo = Array.from(host.querySelectorAll('.m-bot-row')).find(row => row.textContent?.includes('Frodo'))!;
  expect(frodo.querySelector('small')?.textContent).toContain('Earlier from frodo');
  mocks.rosterPreview.frodo = '## Fresh **answer**';
  await act(async () => { for (const handler of mocks.events) handler({ type: 'message.complete', session_id: 'runtime', payload: {} }); });
  await settle();
  expect(frodo.querySelector('small')?.textContent).toBe('Fresh answer');
});

it("board task has a deep-linkable URL and back returns to the board", async () => {
  await renderApp(); await settle();
  await openDestination("Board");
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
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  expect(mocks.request).toHaveBeenCalledWith("session.resume", { profile: "frodo", session_id: "stored", source: "mobile", close_on_disconnect: false, omit_messages: true, defer_history: true });
  expect(host.querySelector('.m-nav')).toBeNull();
  expect(host.textContent).toContain("Earlier");
  await act(async () => { for (const handler of mocks.events) handler({ type: "message.delta", session_id: "runtime", payload: { text: "Streaming" } }); });
  expect(host.textContent).toContain("Streaming");
  await act(async () => (host.querySelector('.m-chat-identity') as HTMLButtonElement).click());
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
  await openDestination("Screen");
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
  await openDestination("Screen");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Continue after hand back") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.steer", {
    profile: "samwise", session_id: "runtime", text: "I cleared the check; continue",
  });
  expect(mocks.request).not.toHaveBeenCalledWith("prompt.submit", expect.anything());
});

it("routes Board and Settings from the profile menu, and offers Screen only with Samwise", async () => {
  await renderApp(); await settle();
  await act(async () => (host.querySelector('[aria-label="Profile menu"]') as HTMLButtonElement).click());
  expect(Array.from(host.querySelectorAll('.m-home-menu a')).map(a => [a.textContent, a.getAttribute('href')])).toEqual([["Board", "/m/board"], ["Settings", "/m/settings"]]);
  await act(async () => (host.querySelector('.m-home-menu a[href="/m/settings"]') as HTMLAnchorElement).click());
  expect(window.location.pathname).toBe('/m/settings');
  await act(async () => (host.querySelector('[aria-label="Back to bots"]') as HTMLButtonElement).click());
  await openDestination("Board");
  expect(window.location.pathname).toBe('/m/board');
});

it("shows the Screen destination only when Samwise is installed", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp(); await settle();
  await act(async () => (host.querySelector('[aria-label="Profile menu"]') as HTMLButtonElement).click());
  expect(host.querySelector('.m-home-menu a[href="/m/screen"]')).not.toBeNull();
  await act(async () => (host.querySelector('.m-home-menu a[href="/m/screen"]') as HTMLAnchorElement).click());
  expect(window.location.pathname).toBe('/m/screen');
});

it("filters bots and searches stored conversation messages across profiles", async () => {
  await renderApp(); await settle();
  await act(async () => (host.querySelector('[aria-label="Search"]') as HTMLButtonElement).click());
  const input = host.querySelector('[aria-label="Search bots and conversations"]') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Gandalf'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.querySelectorAll('.m-pinned-bot')).toHaveLength(1);
  await vi.waitFor(() => expect(mocks.searchSessions).toHaveBeenCalledWith('Gandalf', 'gandalf'));
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('.m-search-result')?.textContent).toContain('Found chat')); });
  await act(async () => (host.querySelector('.m-search-result') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/gandalf/gandalf-found');
});

it("persists a pin action and moves a bot out of the unpinned list", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: 'frodo', is_default: true }, { name: 'gandalf', is_default: false }, { name: 'author', is_default: false }] });
  await renderApp(); await settle();
  expect(host.querySelector('.m-bot-row')?.textContent).toContain('Author');
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  await act(async () => (host.querySelector('.m-pin-choice') as HTMLButtonElement).click());
  expect(host.querySelector('.m-bot-row')).toBeNull();
  expect(values.get(PIN_STORAGE_KEY)).toContain('author');
});

it("long-presses an unpinned bot to pin it without opening its chat", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: 'frodo', is_default: true }, { name: 'author', is_default: false }] });
  await renderApp(); await settle();
  const author = host.querySelector('.m-bot-main') as HTMLButtonElement;
  await act(async () => {
    const touch = new Event('touchstart', { bubbles: true });
    Object.defineProperty(touch, 'touches', { value: [{ clientX: 100, clientY: 250 }] });
    author.dispatchEvent(touch);
    await new Promise(resolve => setTimeout(resolve, 570));
  });
  await act(async () => {
    const touch = new Event('touchend', { bubbles: true });
    Object.defineProperty(touch, 'touches', { value: [] });
    author.dispatchEvent(touch); author.click();
  });
  expect(window.location.pathname).toBe('/m');
  expect(host.querySelector('.m-pin-choice')?.textContent).toBe('Pin bot');
  await act(async () => (host.querySelector('.m-pin-choice') as HTMLButtonElement).click());
  expect(host.querySelectorAll('.m-pinned-bot')).toHaveLength(2);
  expect(host.querySelector('.m-bot-row')).toBeNull();
  expect(storage.get(PIN_STORAGE_KEY)).toContain('author');
});

it("shows a waiting bot's request but still opens the canonical Bot Chat", async () => {
  mocks.waitingProfile = "author";
  mocks.liveSessions = [{ id: "pending-runtime", session_key: "pending-stored", title: "Approval owner", status: "waiting" }];
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "author", is_default: false }] });
  await renderApp(); await settle(); await settle();
  await vi.waitFor(() => expect(host.querySelector('.m-bot-row small')?.textContent).toContain('Needs your input: Approval owner'));
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/author/stored');
});

it("shows the pending approval in the bot's home status without losing its answer card", async () => {
  await renderApp(); await settle();
  await act(async () => { for (const handler of mocks.requests) handler({ id: 'approval-1', method: 'approval', params: { session_id: 'runtime', command: 'run tests', choices: ['once', 'deny'] }, respond: vi.fn(), fail: vi.fn() }); });
  expect(host.querySelector('.m-pinned-bot')?.getAttribute('aria-label')).toBe('Frodo, needs your input');
  expect(host.querySelector('.m-pinned-bot > span:last-of-type')?.textContent).toBe('Frodo');
  expect(host.querySelector('.m-inbox')?.textContent).toContain('run tests');
});

it("submits Continue to the same chat when a running turn finishes before steer", async () => {
  mocks.running = true;
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp();
  await settle(); await settle();
  await openDestination("Screen");
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
