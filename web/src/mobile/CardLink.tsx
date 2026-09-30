import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { cardReference, resolveCard, type CardSummary } from "@hermes/shared";
import { fetchJSON } from "@/lib/api";

export const CardNavigation = createContext<((href: string) => void) | null>(null);
const cache = new Map<string, { card: CardSummary | null; expires: number }>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const base = "/api/plugins/kanban";

export function CardLink({ href }: { href: string }) {
  const reference = cardReference(href)!;
  const navigate = useContext(CardNavigation);
  const key = `${reference.board || ""}/${reference.id}`;
  const card = useSyncExternalStore(subscribe, () => cache.get(key)?.card ?? null);
  useEffect(() => {
    const load = () => {
      if (pending.has(key) || (cache.get(key)?.expires ?? 0) > Date.now()) return;
      const work = resolveCard(reference, "",
        (id, board) => fetchJSON<{ task: CardSummary }>(`${base}/tasks/${id}${board ? `?board=${encodeURIComponent(board)}` : ""}`),
        () => fetchJSON(`${base}/boards`))
        .then(card => { cache.set(key, { card, expires: Date.now() + 30_000 }); })
        .catch(() => { cache.set(key, { card: cache.get(key)?.card ?? null, expires: Date.now() + 10_000 }); })
        .finally(() => { pending.delete(key); listeners.forEach(listener => listener()); });
      pending.set(key, work);
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [key]);
  const target = `/m/board/${reference.id}${card?.board || reference.board ? `?board=${encodeURIComponent(card?.board || reference.board || "")}` : ""}`;
  return <a className="m-card-chip" data-card-id={reference.id} data-status={card?.status} href={target}
    onClick={event => { if (navigate) { event.preventDefault(); navigate(target); } }} title={card ? `${card.title} · ${card.status}` : reference.id}>
    <span>{card?.title || reference.id}</span>{card && <small>{card.status}</small>}
  </a>;
}
