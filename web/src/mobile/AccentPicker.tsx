import { useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { ACCENT_PRESETS, normalizeAccent } from "./accent";
import "./accent-picker.css";

interface AccentPickerProps { value: string; onChange: (value: string) => void }

export function AccentPicker({ value, onChange }: AccentPickerProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const custom = !ACCENT_PRESETS.some(preset => preset.value === value);
  const hex = draft ?? (custom ? value : "");
  const invalid = !!hex && !normalizeAccent(hex);
  return <div className="m-accent-picker">
    <h3 id="m-accent-label">Accent color</h3>
    <div className="m-accent-choices" role="group" aria-labelledby="m-accent-label">
      {ACCENT_PRESETS.map(preset => <button type="button" key={preset.name} aria-pressed={value === preset.value}
        onClick={() => { setDraft(null); onChange(preset.value); }}>
        <span className="m-accent-swatch" style={{ "--swatch": preset.value === "neutral" ? "var(--foreground)" : preset.value } as CSSProperties} aria-hidden="true" />
        {preset.name}<Check size={14} className="m-accent-check" aria-hidden="true" />
      </button>)}
    </div>
    <label className="m-accent-custom">Custom hex
      <input type="text" value={hex} placeholder="#RRGGBB" spellCheck={false} autoComplete="off" maxLength={7}
        aria-invalid={invalid} aria-describedby="m-accent-help" onChange={event => {
          const next = event.currentTarget.value;
          setDraft(next);
          const normalized = normalizeAccent(next);
          if (normalized && normalized !== "neutral") onChange(normalized);
        }} />
    </label>
    <p id="m-accent-help" className={invalid ? "m-accent-invalid" : "m-muted"}>
      {invalid ? "Enter a hex color, like #3b82f6 or #38f." : "Updates instantly. Saved on this device, like appearance."}
    </p>
  </div>;
}
