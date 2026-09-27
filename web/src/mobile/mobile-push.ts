import { authedFetch, fetchJSON, HERMES_BASE_PATH } from "@/lib/api";

interface PushKey { public_key: string }

export function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function pushAvailable(): boolean {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerMobileWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(`${HERMES_BASE_PATH}/mobile-sw.js`, { scope: `${HERMES_BASE_PATH}/` });
}

export async function subscribePush(): Promise<void> {
  if (!pushAvailable()) throw new Error("Web Push needs HTTPS and an installable browser.");
  // This function is invoked only by the Enable button: iOS requires a user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed.");
  const registration = await registerMobileWorker();
  const { public_key } = await fetchJSON<PushKey>("/api/plugins/mobile/push/key");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(public_key) });
  try {
    await fetchJSON("/api/plugins/mobile/push/subscriptions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()),
    });
  } catch (error) {
    if (!existing) await subscription.unsubscribe();
    throw error;
  }
}

export async function unsubscribePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(`${HERMES_BASE_PATH}/`);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await fetchJSON("/api/plugins/mobile/push/subscriptions", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

export async function localSignOut(): Promise<void> {
  // Both logout routes preserve the upstream Google grant; this one returns JSON
  // before navigating so a failed local sign-out cannot look like success.
  const response = await authedFetch("/api/mobile/logout", { method: "POST" });
  if (!response.ok) {
    throw new Error("Sign out failed; your session is still active.");
  }
  window.location.assign(`${HERMES_BASE_PATH}/m`);
}

export async function signOutMobile(): Promise<void> {
  try { await unsubscribePush(); }
  catch { /* The logout route removes this browser's enrolled endpoints too. */ }
  await localSignOut();
}
