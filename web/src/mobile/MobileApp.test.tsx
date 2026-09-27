// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfiles: vi.fn(async () => ({ profiles: [{ name: "frodo", is_default: true }, { name: "gandalf", is_default: false }] })),
  request: vi.fn(async (method: string) => {
    if (method === "session.list") return { sessions: [{ id: "stored", title: "Prior chat" }] };
    if (method === "session.active_list") return { sessions: [] };
    if (method === "session.most_recent") return { session_id: "stored" };
    if (method === "session.resume") return { session_id: "runtime", stored_session_id: "stored", messages: [{ role: "user", text: "Earlier" }] };
    if (method === "session.create") return { session_id: "new-runtime", stored_session_id: "new-stored", messages: [] };
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
import MobileApp from "./MobileApp";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Element.prototype.scrollIntoView = vi.fn(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.events.clear(); mocks.requests.clear(); });
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

it("resumes a profile's stored session, streams its runtime id, stops the turn, and answers a pending approval", async () => {
  await act(async () => root.render(<MobileApp />));
  await settle(); await settle();
  expect(mocks.request).toHaveBeenCalledWith("session.resume", { profile: "frodo", session_id: "stored" });
  expect(host.textContent).toContain("Earlier");
  await act(async () => { for (const handler of mocks.events) handler({ type: "message.delta", session_id: "runtime", payload: { text: "Streaming" } }); });
  expect(host.textContent).toContain("Streaming");
  const respond = vi.fn();
  await act(async () => { for (const handler of mocks.requests) handler({ id: "srq-1", method: "approval", params: { session_id: "runtime", request_id: "ap-1", choices: ["once", "deny"], command: "ls" }, respond, fail: vi.fn() }); });
  expect(host.textContent).toContain("Approve command?");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Allow once") as HTMLButtonElement).click());
  expect(respond).toHaveBeenCalledWith({ choice: "once" });
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Stop") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.interrupt", { profile: "frodo", session_id: "runtime" });
});
