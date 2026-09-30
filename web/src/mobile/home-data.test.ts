import { describe, expect, it } from "vitest";
import type { ProfileInfo } from "@/lib/api";
import { activityTime, movePin, orderedBots, PIN_STORAGE_KEY, savedPins } from "./home-data";

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

  it("partitions the five installed profiles into three default pins and a recency-sorted remainder", () => {
    const pins = savedPins({ getItem: () => null });
    expect(pins).toEqual(["default", "gandalf", "samwise"]);
    expect(savedPins({ getItem: key => key === "hermes-mobile-pins" ? '["default","gandalf","samwise","gimli","author"]' : null })).toEqual(pins);
    const activity = {
      author: { session: "a", preview: "", lastActive: 90 },
      gimli: { session: "b", preview: "", lastActive: 30 },
    };
    const { pinned, others } = orderedBots(profiles, pins, activity);
    expect(pinned.map(p => p.name)).toEqual(["default", "gandalf", "samwise"]);
    expect(others.map(p => p.name)).toEqual(["author", "gimli"]);
    expect(new Set([...pinned, ...others].map(p => p.name)).size).toBe(profiles.length);
  });

  it("aliases the default pin to the real default profile without duplicating an explicit pin", () => {
    const renamed = [{ name: "frodo", is_default: true }, { name: "gandalf" }] as ProfileInfo[];
    const { pinned, others } = orderedBots(renamed, ["default", "frodo", "gandalf"], {});
    expect(pinned.map(p => p.name)).toEqual(["frodo", "gandalf"]);
    expect(others).toEqual([]);
  });

  it("keeps the user's empty pin choice and swaps only the visible neighbours", () => {
    expect(savedPins({ getItem: () => "[]" })).toEqual([]);
    const pins = ["default", "gone-for-now", "gandalf", "samwise"];
    expect(movePin(pins, "frodo", "gandalf", "frodo")).toEqual(["gandalf", "gone-for-now", "default", "samwise"]);
    expect(pins[0]).toBe("default");
  });

  it("starts with the requested pins when unset, and labels activity by local calendar day", () => {
    expect(savedPins({ getItem: () => null })).toEqual(expect.arrayContaining(["default", "gandalf", "samwise"]));
    const now = new Date(2026, 8, 27, 10).getTime();
    expect(activityTime(new Date(2026, 8, 26, 23).getTime() / 1000, now)).toBe("Yesterday");
    expect(activityTime(new Date(2026, 8, 27, 9, 30).getTime() / 1000, now)).toBe(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 8, 27, 9, 30)));
  });
});
