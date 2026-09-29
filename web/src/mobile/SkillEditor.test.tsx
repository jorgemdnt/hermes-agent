// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkillEditor, type SkillEditorHandle } from "./SkillEditor";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let ref: ReturnType<typeof createRef<SkillEditorHandle>>;
let changed: ReturnType<typeof vi.fn<(value: string, cursor: number, picked: string[]) => void>>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  ref = createRef<SkillEditorHandle>(); changed = vi.fn();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("inserts an atomic skill, serializes it, and deletes it with Backspace", async () => {
  await act(async () => root.render(<SkillEditor ref={ref} scope="default/a" value="/test" picked={[]} placeholder="Message" onChange={changed} onFiles={() => {}} onKeyDown={() => {}} />));
  await act(async () => ref.current!.insertSkill(0, 5, "/test"));
  const editor = host.querySelector<HTMLElement>(".m-skill-editor")!;
  const chip = editor.querySelector<HTMLElement>(".m-skill-pill")!;
  expect(chip.contentEditable).toBe("false");
  expect(chip.dataset.skill).toBe("/test");
  expect(changed).toHaveBeenLastCalledWith("/test ", 6, ["/test"]);
  const selection = window.getSelection()!;
  const range = document.createRange(); range.setStartAfter(chip); range.collapse(true);
  selection.removeAllRanges(); selection.addRange(range);
  await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
  expect(editor.querySelector(".m-skill-pill")).toBeNull();
});

it("restores picked tokens from a persisted draft without painting plain slash text as a skill", async () => {
  await act(async () => root.render(<SkillEditor ref={ref} scope="default/a" value="/test instructions" picked={["/test"]} placeholder="Message" onChange={changed} onFiles={() => {}} onKeyDown={() => {}} />));
  expect(host.querySelectorAll(".m-skill-pill")).toHaveLength(1);
  await act(async () => root.render(<SkillEditor ref={ref} scope="default/b" value="/test instructions" picked={[]} placeholder="Message" onChange={changed} onFiles={() => {}} onKeyDown={() => {}} />));
  expect(host.querySelectorAll(".m-skill-pill")).toHaveLength(0);
});
