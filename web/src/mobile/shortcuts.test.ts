import { expect, it } from "vitest";
import { parseShortcut } from "./shortcuts";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = { metaKey: true }) =>
  parseShortcut({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

it("maps Cmd or Ctrl chords to actions", () => {
  expect(key("3")).toEqual({ kind: "nth", index: 2 });
  expect(key("3", { ctrlKey: true })).toEqual({ kind: "nth", index: 2 });
  expect(key("[")).toEqual({ kind: "previous" });
  expect(key("]")).toEqual({ kind: "next" });
  expect(key("n")).toEqual({ kind: "new" });
  expect(key("k")).toEqual({ kind: "search" });
  expect(key("/")).toEqual({ kind: "help" });
  expect(key("A", { metaKey: true, shiftKey: true })).toEqual({ kind: "archive" });
  expect(key("u", { ctrlKey: true, shiftKey: true })).toEqual({ kind: "unread" });
});

it("ignores bare keys, Alt chords, zero, and other shifted chords", () => {
  expect(key("n", {})).toBeNull();
  expect(key("n", { metaKey: true, altKey: true })).toBeNull();
  expect(key("0")).toBeNull();
  expect(key("n", { metaKey: true, shiftKey: true })).toBeNull();
});
