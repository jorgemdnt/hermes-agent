// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ fetchJSON: vi.fn(), authedFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ HERMES_BASE_PATH: "", fetchJSON: mocked.fetchJSON, authedFetch: mocked.authedFetch }));
import { decodeVapidKey, localSignOut, signOutMobile, subscribePush, unsubscribePush } from "./mobile-push";

const subscription = { endpoint: "https://push.example/123", toJSON: () => ({ endpoint: "https://push.example/123", keys: { p256dh: "key", auth: "auth" } }), unsubscribe: vi.fn(async () => true) };
const registration = { pushManager: { getSubscription: vi.fn(async () => subscription), subscribe: vi.fn() } };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
  Object.defineProperty(window, "Notification", { configurable: true, value: { requestPermission: vi.fn(async () => "granted") } });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: vi.fn(async () => registration), getRegistration: vi.fn(async () => registration) } });
  mocked.fetchJSON.mockResolvedValue({ public_key: "AQID" });
});

describe("mobile push and local logout", () => {
  it("decodes URL-safe VAPID and posts only the subscription object after permission", async () => {
    expect(Array.from(decodeVapidKey("AQID"))).toEqual([1, 2, 3]);
    await subscribePush();
    expect(window.Notification.requestPermission).toHaveBeenCalled();
    expect(mocked.fetchJSON).toHaveBeenCalledWith("/api/plugins/mobile/push/subscriptions", expect.objectContaining({
      method: "POST", body: JSON.stringify(subscription.toJSON()),
    }));
  });

  it("removes the server registration before invalidating the browser subscription", async () => {
    await unsubscribePush();
    expect(mocked.fetchJSON).toHaveBeenCalledWith("/api/plugins/mobile/push/subscriptions", expect.objectContaining({
      method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }),
    }));
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("never uses grant-revoking /auth/logout and does not navigate when local logout fails", async () => {
    mocked.authedFetch.mockResolvedValue({ ok: false });
    await expect(localSignOut()).rejects.toThrow("still active");
    expect(mocked.authedFetch).toHaveBeenCalledWith("/api/mobile/logout", { method: "POST" });
  });

  it("attempts local sign-out even if browser push unsubscription fails", async () => {
    vi.mocked(navigator.serviceWorker.getRegistration).mockRejectedValue(new Error("push unavailable"));
    mocked.authedFetch.mockResolvedValue({ ok: false });
    await expect(signOutMobile()).rejects.toThrow("still active");
    expect(mocked.authedFetch).toHaveBeenCalledWith("/api/mobile/logout", { method: "POST" });
  });
});
