import type { ProfileInfo } from "@/lib/api";

export interface BotActivity { session: string; preview: string; lastActive: number }

const DEFAULT_PINS = ["default", "frodo", "gandalf", "samwise"];
export const PIN_STORAGE_KEY = "hermes-mobile-pins";

export function savedPins(storage: Pick<Storage, "getItem">): string[] {
  try {
    const raw = storage.getItem(PIN_STORAGE_KEY);
    if (raw === null) return DEFAULT_PINS;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((name): name is string => typeof name === "string"))] : DEFAULT_PINS;
  } catch { return DEFAULT_PINS; }
}

export function orderedBots(profiles: ProfileInfo[], pins: string[], activity: Record<string, BotActivity>) {
  const byName = new Map(profiles.map(profile => [profile.name, profile]));
  const pinned = pins.map(name => byName.get(name)).filter((profile): profile is ProfileInfo => !!profile);
  const pinnedNames = new Set(pinned.map(profile => profile.name));
  const others = profiles.filter(profile => !pinnedNames.has(profile.name)).sort((a, b) =>
    (activity[b.name]?.lastActive || 0) - (activity[a.name]?.lastActive || 0) || a.name.localeCompare(b.name));
  return { pinned, others };
}

export function activityTime(timestamp: number, now = Date.now(), locale?: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp * 1000);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date);
}
