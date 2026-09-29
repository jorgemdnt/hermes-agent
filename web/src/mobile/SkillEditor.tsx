import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

export interface SkillEditorHandle { focus: (options?: FocusOptions) => void; insertSkill: (start: number, end: number, name: string) => void }

function serial(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node instanceof HTMLElement && node.dataset.skill) return node.dataset.skill;
  if (node instanceof HTMLBRElement) return "\n";
  return Array.from(node.childNodes).map(serial).join("");
}
function skills(root: HTMLElement) { return Array.from(root.querySelectorAll<HTMLElement>("[data-skill]")).map(node => node.dataset.skill!); }
function caret(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return serial(root).length;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return serial(range.cloneContents()).length;
}
function at(root: HTMLElement, offset: number): Range {
  const range = document.createRange();
  let position = 0;
  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length || 0;
      if (offset < position + length) { range.setStart(node, offset - position); return true; }
      position += length; return false;
    }
    if (node instanceof HTMLElement && node.dataset.skill) {
      const length = node.dataset.skill.length;
      if (offset < position + length) { range.setStartBefore(node); return true; }
      position += length; return false;
    }
    for (const child of Array.from(node.childNodes)) if (visit(child)) return true;
    return false;
  };
  if (!visit(root)) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  return range;
}
function skillPill(token: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "m-skill-pill";
  chip.contentEditable = "false";
  chip.dataset.skill = token;
  chip.setAttribute("aria-label", `Skill ${token.slice(1)}`);
  const icon = document.createElement("span");
  icon.className = "m-skill-pill-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
  const label = document.createElement("span");
  label.textContent = token.slice(1);
  chip.append(icon, label);
  return chip;
}

function paint(root: HTMLElement, value: string, picked: string[]) {
  root.replaceChildren();
  const names = new Set(picked);
  const re = /(^|\s)(\/[\w.-]+)(?=\s|$)/g;
  let last = 0;
  for (const match of value.matchAll(re)) {
    const token = match[2];
    if (!names.has(token)) continue;
    const start = match.index! + match[1].length;
    root.append(document.createTextNode(value.slice(last, start)));
    root.append(skillPill(token));
    last = start + token.length;
  }
  root.append(document.createTextNode(value.slice(last)));
}

export const SkillEditor = forwardRef<SkillEditorHandle, {
  scope: string; value: string; picked: string[]; placeholder: string;
  onChange: (value: string, cursor: number, picked: string[]) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFiles: (files: File[]) => void;
}>(function SkillEditor({ scope, value, picked, placeholder, onChange, onKeyDown, onFiles }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const priorScope = useRef("");
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || (priorScope.current === scope && serial(el) === value)) return;
    const focused = document.activeElement === el;
    const position = focused && priorScope.current === scope ? caret(el) : value.length;
    paint(el, value, picked);
    if (focused) {
      const range = at(el, Math.min(position, value.length));
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    }
    priorScope.current = scope;
  }, [scope, value, picked]);
  useImperativeHandle(ref, () => ({
    focus: options => root.current?.focus(options),
    insertSkill: (start, end, name) => {
      const el = root.current;
      if (!el) return;
      const before = at(el, start), after = at(el, end);
      const range = document.createRange();
      range.setStart(before.startContainer, before.startOffset);
      range.setEnd(after.startContainer, after.startOffset);
      range.deleteContents();
      const chip = skillPill(name);
      range.insertNode(chip);
      const space = document.createTextNode(" "); chip.after(space);
      el.focus();
      const selection = window.getSelection(); const next = document.createRange();
      next.setStart(space, 1); next.collapse(true); selection?.removeAllRanges(); selection?.addRange(next);
      onChange(serial(el), caret(el), skills(el));
    },
  }));
  const changed = () => { const el = root.current; if (el) onChange(serial(el), caret(el), skills(el)); };
  return <div ref={root} role="textbox" aria-label="Message" aria-multiline="true" data-placeholder={placeholder} className="m-skill-editor" contentEditable suppressContentEditableWarning
    onInput={changed} onSelect={changed} onKeyDown={event => {
      if (event.key === "Backspace" && !event.nativeEvent.isComposing) {
        const el = root.current;
        const position = el && caret(el);
        if (el && position) {
          let from = 0;
          for (const node of Array.from(el.childNodes)) {
            const length = serial(node).length;
            if (node instanceof HTMLElement && node.dataset.skill && from + length === position) {
              event.preventDefault(); node.remove(); changed(); return;
            }
            from += length;
          }
        }
      }
      onKeyDown(event);
    }} onPaste={(event: ClipboardEvent<HTMLDivElement>) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); onFiles(files); return; }
      event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    }} />;
});
