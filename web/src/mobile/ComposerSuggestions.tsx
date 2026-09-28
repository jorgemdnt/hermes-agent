import { useCallback, useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { GatewayClient } from "@/lib/gatewayClient";
import type { ProfileInfo } from "@/lib/api";

interface Entry { text: string; display?: string; meta?: string; kind?: string }
interface Suggestion extends Entry { label: string; group: string }

export function useComposerSuggestions({ scope, text, setText, cursor, gateway, sessionId, profiles, input }: {
  scope: string; text: string; setText: (text: string) => void; cursor: number; gateway: GatewayClient | null; sessionId?: string; profiles: ProfileInfo[]; input: RefObject<HTMLTextAreaElement | null>;
}) {
  const [byScope, setByScope] = useState<Record<string, { items: Suggestion[]; active: number; dismissed: string }>>({});
  const { items, active, dismissed } = byScope[scope] ?? { items: [], active: 0, dismissed: "" };
  const update = useCallback((change: (state: { items: Suggestion[]; active: number; dismissed: string }) => { items: Suggestion[]; active: number; dismissed: string }) =>
    setByScope(current => ({ ...current, [scope]: change(current[scope] ?? { items: [], active: 0, dismissed: "" }) })), [scope]);
  const setItems = useCallback((items: Suggestion[]) => update(state => ({ ...state, items })), [update]);
  const setActive = useCallback((value: number | ((active: number) => number)) => update(state => ({ ...state, active: typeof value === "function" ? value(state.active) : value })), [update]);
  const setDismissed = useCallback((dismissed: string) => update(state => ({ ...state, dismissed })), [update]);
  const prefix = text.slice(0, cursor);
  const match = /(^|\s)(\/[\w.-]*(?:\s+[^\n]*)?|@[\w.-]*)$/.exec(prefix);
  const query = match?.[2] || "";
  const open = !!match && query !== dismissed && items.length > 0;
  useEffect(() => {
    if (!query || !gateway) { setItems([]); return; }
    if (query.startsWith("@")) {
      const needle = query.slice(1).toLowerCase();
      setItems(profiles.filter(p => (p.name === "default" ? "hermes" : p.name).startsWith(needle) || (p.display_name || "").toLowerCase().startsWith(needle))
        .map(p => ({ text: `@${p.name === "default" ? "hermes" : p.name}`, label: p.display_name || p.name, group: "Bots" })));
      setActive(0); return;
    }
    let alive = true;
    const load = async () => {
      try {
        const params = sessionId ? { session_id: sessionId } : {};
        let next: Suggestion[];
        if (query === "/") {
          const catalog = await gateway.request<{ pairs?: Array<[string, string]>; categories?: Array<{ name: string; pairs: Array<[string, string]> }> }>("commands.catalog", params);
          const groups = new Map<string, Suggestion>();
          for (const category of catalog.categories || []) for (const [command, meta] of category.pairs) groups.set(command, { text: command, label: command, meta, group: category.name });
          for (const [command, meta] of catalog.pairs || []) if (!groups.has(command)) groups.set(command, { text: command, label: command, meta, group: "Skills" });
          const all = [...groups.values()];
          const commands = all.filter(item => item.group !== "Skills");
          const skills = all.filter(item => item.group === "Skills");
          next = [...commands.slice(0, skills.length ? 20 : 40), ...skills.slice(0, 20)];
        } else {
          const result = await gateway.request<{ items?: Entry[]; replace_from?: number }>("complete.slash", { text: query, ...params });
          const from = result.replace_from || 1;
          next = (result.items || []).map(entry => ({ ...entry, text: from > 1 ? query.slice(0, from) + entry.text : entry.text, label: entry.display || entry.text, group: entry.kind === "skill" ? "Skills" : "Commands" }));
        }
        if (alive) { setItems(next.slice(0, 40)); setActive(0); }
      } catch { if (alive) setItems([]); }
    };
    const timer = window.setTimeout(() => void load(), query === "/" ? 0 : 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, gateway, sessionId, profiles, setItems, setActive]);
  const pick = useCallback((item: Suggestion) => {
    if (!match) return;
    const next = text.slice(0, match.index + match[1].length) + item.text + " " + text.slice(cursor);
    const position = match.index + match[1].length + item.text.length + 1;
    setText(next); setItems([]); setDismissed(item.text);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position); });
  }, [match, text, cursor, input, setText, setItems, setDismissed]);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") { event.preventDefault(); setDismissed(query); return true; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length); return true; }
    if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(items[active]); return true; }
    return false;
  };
  const suggestions = open && <div className="m-suggestions" role="listbox" aria-label={query.startsWith("@") ? "Mention a bot" : "Slash commands"}>
    {items.map((item, index) => <button type="button" key={`${item.text}-${index}`} role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onClick={() => pick(item)}>
      <strong>{item.label}</strong>{item.meta && <small>{item.meta}</small>}<span>{item.group}</span>
    </button>)}
  </div>;
  return { suggestions, onKeyDown, open };
}
