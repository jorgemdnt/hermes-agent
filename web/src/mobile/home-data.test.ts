import { describe, expect, it } from "vitest";
import type { ProfileInfo } from "@/lib/api";
import { activityTime, orderedBots, PIN_STORAGE_KEY, savedPins } from "./home-data";

const profiles = ["gimli", "samwise", "gandalf", "default", "author"].map(name => ({ name })) as ProfileInfo[];

describe("mobile home order", () => {
  it("keeps the local pin order and excludes pinned bots from the recency list", () => {
    const storage = { getItem: (key: string) => key === PIN_STORAGE_KEY ? '["gandalf","default","missing","gandalf"]' : null };
    const pins = savedPins(storage);
    const { pinned, others } = orderedBots(profiles, pins, {
      samwise: { session: "a", preview: "", lastActive: 30 },
      gimli: { session: "b", preview: "", lastActive: 90 },
      author: { session: "c", preview: "", lastActive: 10 },
      gandalf: { session: "d", preview: "", lastActive: 100 },
    });
    expect(pinned.map(p => p.name)).toEqual(["gandalf", "default"]);
    expect(others.map(p => p.name)).toEqual(["gimli", "samwise", "author"]);
  });

  it("starts with the requested pins when unset, and labels activity by local calendar day", () => {
    expect(savedPins({ getItem: () => null })).toEqual(expect.arrayContaining(["default", "gandalf", "samwise"]));
    const now = new Date(2026, 8, 27, 10).getTime();
    expect(activityTime(new Date(2026, 8, 26, 23).getTime() / 1000, now)).toBe("Yesterday");
    expect(activityTime(new Date(2026, 8, 27, 9, 30).getTime() / 1000, now)).toBe(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 8, 27, 9, 30)));
  });
});
