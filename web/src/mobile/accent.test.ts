import { expect, it } from "vitest";
import { ACCENT_PRESETS, accentStyle, contrastRatio, normalizeAccent } from "./accent";

it("preserves chosen fills while readable text and foregrounds pass AA on both palettes", () => {
  const colors = new Set(ACCENT_PRESETS.map(p => p.value as string));
  for (const r of [0, 51, 102, 153, 204, 255]) for (const g of [0, 51, 102, 153, 204, 255]) for (const b of [0, 51, 102, 153, 204, 255]) {
    colors.add(`#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`);
  }
  const tint = (hex: string, bg: string) => `#${[1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * .12 + parseInt(bg.slice(i, i + 2), 16) * .88).toString(16).padStart(2, "0")).join("")}`;
  for (const color of colors) for (const dark of [false, true]) {
    if (color === "neutral") { expect(accentStyle(color, dark)).toEqual({}); continue; }
    const styles = accentStyle(color, dark) as Record<string, string>;
    expect(styles["--accent"]).toBe(color);
    expect(contrastRatio(color, styles["--accent-foreground"])).toBeGreaterThanOrEqual(4.5);
    const bg = dark ? "#0a0a0a" : "#ffffff";
    for (const surface of [bg, dark ? "#141414" : "#ffffff", dark ? "#1a1a1a" : "#fafafa", dark ? "#1a1a1a" : "#f2f2f2", tint(color, bg)]) {
      expect(contrastRatio(styles["--accent-text"], surface), `${color} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(normalizeAccent("#AbC")).toBe("#aabbcc");
  for (const invalid of [null, "", "#gggggg", "#1234", "red", "url(x)"]) expect(normalizeAccent(invalid)).toBeNull();
});
