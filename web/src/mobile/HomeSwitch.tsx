import { useRef, type KeyboardEvent } from "react";

export type HomeTab = "bots" | "chats" | "board";
const TABS: ReadonlyArray<{ value: HomeTab; label: string }> = [{ value: "bots", label: "Bots" }, { value: "chats", label: "Chats" }, { value: "board", label: "Board" }];

/** Arrow keys move one segment; Home and End select the edges. */
export function HomeSwitch({ value, onChange, chatsUnread }: { value: HomeTab; onChange: (tab: HomeTab) => void; chatsUnread: number }) {
  const buttons = useRef<Record<HomeTab, HTMLButtonElement | null>>({ bots: null, chats: null, board: null });
  const move = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = TABS.findIndex(tab => tab.value === value);
    const next = TABS[event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + TABS.length) % TABS.length].value;
    onChange(next);
    buttons.current[next]?.focus();
  };
  return <div className="m-home-switch" role="radiogroup" aria-label="Show bots, chats or board" data-value={value} onKeyDown={move}>
    <span className="m-home-switch-thumb" aria-hidden="true" />
    {TABS.map(tab => <button key={tab.value} type="button" role="radio" aria-checked={value === tab.value} tabIndex={value === tab.value ? 0 : -1}
      ref={node => { buttons.current[tab.value] = node; }} onClick={() => onChange(tab.value)}>
      {tab.label}
      {tab.value === "chats" && chatsUnread > 0 && <span className="m-home-switch-badge" aria-label={`${chatsUnread} unread`}>{chatsUnread > 99 ? "99+" : chatsUnread}</span>}
    </button>)}
  </div>;
}
