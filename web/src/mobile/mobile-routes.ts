export type MobileView = "bots" | "chat" | "board" | "screen" | "settings" | "subscriptions";

export interface MobileRoute {
  view: MobileView;
  profile?: string;
  session?: string;
  task?: string;
}

export function mobileRoute(pathname: string): MobileRoute {
  const parts = pathname.replace(/\/+$/, "").split("/").slice(1);
  if (parts[0] !== "m") return { view: "bots" };
  if (parts[1] === "chat" && parts[2] && parts[3] && parts.length === 4) {
    try { return { view: "chat", profile: decodeURIComponent(parts[2]), session: decodeURIComponent(parts[3]) }; }
    catch { return { view: "bots" }; }
  }
  if (parts[1] === "board" && parts[2] && parts.length === 3) {
    try { return { view: "board", task: decodeURIComponent(parts[2]) }; }
    catch { return { view: "bots" }; }
  }
  if (parts[1] === "board" && parts.length === 2) return { view: "board" };
  if (parts[1] === "screen" && parts[2] && parts.length === 3) return { view: "screen", profile: decodeURIComponent(parts[2]) };
  if (parts[1] === "screen" && parts.length === 2) return { view: "screen", profile: "samwise" };
  if (parts[1] === "settings" && parts.length === 2) return { view: "settings" };
  if (parts[1] === "subscriptions" && parts.length === 2) return { view: "subscriptions" };
  return { view: "bots" };
}

export const chatPath = (profile: string, session: string) => `/m/chat/${encodeURIComponent(profile)}/${encodeURIComponent(session || "new")}`;
export const taskPath = (task: string) => `/m/board/${encodeURIComponent(task)}`;
