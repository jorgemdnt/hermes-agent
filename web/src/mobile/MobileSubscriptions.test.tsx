// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSubscriptions: vi.fn(), startOAuthLogin: vi.fn(), pollOAuthSession: vi.fn(),
  removeCredentialPoolEntry: vi.fn(), cancelOAuthSession: vi.fn(), setCredentialPoolStrategy: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: mocks }));
import MobileSubscriptions from "./MobileSubscriptions";

const fixture = () => ({ providers: [
  { provider: "openai-codex", strategy: "round_robin", rotation_supported: true, entries: [
    { id: "one", index: 1, account: "first@example.com", plan: "Pro", status: "active", in_use: true, windows: { weekly: { used_percent: 24, reset_at: "2026-10-03T00:00:00Z" } } },
    { id: "two", index: 2, account: "second@example.com", plan: "Pro", status: "active", in_use: false, windows: {} },
  ] },
  { provider: "anthropic", strategy: "fill_first", rotation_supported: false, entries: [] },
  { provider: "xai-oauth", strategy: "fill_first", rotation_supported: true, entries: [] },
] });
let host: HTMLDivElement;
let root: Root;
const button = (label: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent === label)!;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.getSubscriptions.mockImplementation(async () => fixture());
  mocks.removeCredentialPoolEntry.mockResolvedValue({ ok: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("renders provider-supplied windows per account, never an invented 5-hour number", async () => {
  await act(async () => root.render(<MobileSubscriptions />));
  expect(host.textContent).toContain("first@example.com");
  expect(host.textContent).toContain("24% used");
  expect(host.textContent).toContain("Not reported");
  expect(host.textContent).toContain("Claude runs through your official Claude Code login");
});

it("starts append, opens the provider page and refreshes the list on approval", async () => {
  const open = vi.fn(); vi.stubGlobal("open", open);
  mocks.startOAuthLogin.mockResolvedValue({ flow: "device_code", session_id: "session", user_code: "CODE", verification_url: "https://auth.openai.com/codex/device" });
  mocks.pollOAuthSession.mockResolvedValue({ status: "approved" });
  await act(async () => root.render(<MobileSubscriptions />));
  await act(async () => button("Add subscription").click());
  expect(mocks.startOAuthLogin).toHaveBeenCalledWith("openai-codex", true);
  expect(open).toHaveBeenCalledWith("https://auth.openai.com/codex/device", "_blank", "noopener,noreferrer");
  expect(host.textContent).toContain("CODE");
});

it("removes only the chosen row and refreshes without disconnect", async () => {
  vi.stubGlobal("confirm", () => true);
  await act(async () => root.render(<MobileSubscriptions />));
  await act(async () => (host.querySelector('[aria-label="Remove second@example.com from Codex"]') as HTMLButtonElement).click());
  expect(mocks.removeCredentialPoolEntry).toHaveBeenCalledWith("openai-codex", 2);
  expect(mocks.getSubscriptions).toHaveBeenCalledWith(true);
});

it("updates Codex rotation through the pool strategy endpoint", async () => {
  await act(async () => root.render(<MobileSubscriptions />));
  const select = host.querySelector('[aria-label="Codex rotation"]') as HTMLSelectElement;
  expect(select.value).toBe("round_robin");
  await act(async () => { select.value = "least_used"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(mocks.setCredentialPoolStrategy).toHaveBeenCalledWith("openai-codex", "least_used");
});
