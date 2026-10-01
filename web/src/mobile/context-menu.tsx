import { useRef, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";

// One action list feeds both the pointer ContextMenu and the touch sheet.
export interface MenuAction {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** The touch sheet stays open after this action (pin reordering). */
  stay?: boolean;
}

const isMenuKey = (event: KeyboardEvent) => event.key === "ContextMenu" || event.key === "F10" && event.shiftKey;

// Radix opens a ContextMenu from a contextmenu event's coordinates; keyboard users get it beside the focused row.
// Dispatched after the keydown handler returns: React 19.3 drops a contextmenu nested inside its own keydown dispatch.
function openMenuFromKeyboard(event: KeyboardEvent<HTMLElement>) {
  const row = event.currentTarget;
  const rect = row.getBoundingClientRect();
  queueMicrotask(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 16, clientY: rect.top + rect.height / 2 })));
}

// Row gestures for both menu surfaces. sheetMode (phone) opens the touch sheet on long-press, contextmenu
// and the menu keys; otherwise right-click and the menu keys reach the Radix ContextMenu at the pointer.
export function useRowGestures(sheetMode: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const stop = () => { clearTimeout(timer.current ?? undefined); timer.current = null; };
  return (openSheet: () => void, click: () => void) => ({
    onTouchStart: () => {
      stop(); fired.current = false;
      if (sheetMode) timer.current = setTimeout(() => { fired.current = true; openSheet(); }, 550);
    },
    onTouchMove: stop,
    onTouchEnd: stop,
    onTouchCancel: stop,
    onContextMenu: (event: ReactMouseEvent) => {
      stop();
      if (sheetMode) { event.preventDefault(); openSheet(); }
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!isMenuKey(event)) return;
      event.preventDefault();
      if (sheetMode) openSheet(); else openMenuFromKeyboard(event);
    },
    onClick: () => {
      if (fired.current) { fired.current = false; return; }
      click();
    },
  });
}

// shadcn v4 ContextMenu composition (Root → Trigger asChild → Portal → Content → Item), styled with the shell's dropdown tokens.
export function RowContextMenu({ actions, label, container, disabled, children }: { actions: MenuAction[]; label: string; container: HTMLElement | null; disabled: boolean; children: ReactElement }) {
  return <ContextMenuPrimitive.Root modal={false}>
    <ContextMenuPrimitive.Trigger asChild disabled={disabled}>{children}</ContextMenuPrimitive.Trigger>
    <ContextMenuPrimitive.Portal container={container}>
      <ContextMenuPrimitive.Content data-slot="context-menu-content" className="m-dropdown m-context-menu" aria-label={label} collisionPadding={8}>
        {actions.map(action => <ContextMenuPrimitive.Item key={action.id} data-slot="context-menu-item" disabled={action.disabled} onSelect={action.onSelect}>{action.label}</ContextMenuPrimitive.Item>)}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  </ContextMenuPrimitive.Root>;
}

export function ActionList({ actions, onDone }: { actions: MenuAction[]; onDone: () => void }) {
  return <>{actions.map(action => <button key={action.id} type="button" className="m-pin-choice" disabled={action.disabled}
    onClick={() => { action.onSelect(); if (!action.stay) onDone(); }}>{action.label}</button>)}</>;
}
