import { X } from "lucide-react";
import { SHORTCUT_HELP } from "./shortcuts";
import { Button, Sheet } from "./ui";

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <Sheet open onClose={onClose} label="Keyboard shortcuts">
    <div className="m-activity-head"><h2>Keyboard shortcuts</h2><Button type="button" variant="ghost" size="icon" aria-label="Close shortcuts" onClick={onClose}><X size={21} /></Button></div>
    <dl className="m-shortcuts">{SHORTCUT_HELP.map(item => <div key={item.keys}><dt><kbd>{item.keys}</kbd></dt><dd>{item.label}</dd></div>)}</dl>
    <p className="m-muted">In a browser tab, Ctrl works where Cmd is taken.</p>
  </Sheet>;
}
