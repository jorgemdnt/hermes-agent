import type { CSSProperties } from "react";

export const ACCENT_STORAGE_KEY = "hermes-mobile-accent";
export const ACCENT_PRESETS = [
  { name: "Neutral", value: "neutral" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Pink", value: "#ec4899" },
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#eab308" },
] as const;

export function normalizeAccent(value: string | null): string | null {
  if (value === "neutral") return value;
  const hex = value?.trim().replace(/^#/, "");
  if (!hex || !/^(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(hex)) return null;
  return `#${(hex.length === 3 ? [...hex].map(c => c + c).join("") : hex).toLowerCase()}`;
}

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => channels(hex).map(c => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

export function contrastRatio(a: string, b: string): number {
  const light = luminance(a), dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

function mix(a: string, b: string, weight: number): string {
  const other = channels(b);
  return `#${channels(a).map((c, i) => Math.round(c * weight + other[i] * (1 - weight)).toString(16).padStart(2, "0")).join("")}`;
}

export function accentStyle(value: string, dark: boolean): CSSProperties {
  const accent = normalizeAccent(value);
  if (!accent || accent === "neutral") return {};
  const background = dark ? "#0a0a0a" : "#ffffff";
  const surfaces = [background, dark ? "#141414" : "#ffffff", dark ? "#1a1a1a" : "#fafafa", dark ? "#1a1a1a" : "#f2f2f2", mix(accent, background, 0.12)];
  const target = dark ? "#ffffff" : "#000000";
  let text = accent;
  // Keep arbitrary hex fills exact; only shade text/rings to pass AA on their surfaces.
  for (let step = 0; step <= 100; step++) {
    text = mix(accent, target, 1 - step / 100);
    if (surfaces.every(surface => contrastRatio(text, surface) >= 4.5)) break;
  }
  return {
    "--accent": accent,
    "--accent-foreground": contrastRatio(accent, "#000000") >= contrastRatio(accent, "#ffffff") ? "#000000" : "#ffffff",
    "--accent-text": text,
  } as CSSProperties;
}
