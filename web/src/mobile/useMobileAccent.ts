import { useEffect, useMemo, useState } from "react";
import { ACCENT_STORAGE_KEY, accentStyle, normalizeAccent } from "./accent";

export function useMobileAccent(theme: "light" | "dark" | "system") {
  const [accent, setAccent] = useState(() => normalizeAccent(localStorage.getItem(ACCENT_STORAGE_KEY)) || "neutral");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(media.matches);
    media.addEventListener("change", sync);
    sync();
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => { localStorage.setItem(ACCENT_STORAGE_KEY, accent); }, [accent]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === ACCENT_STORAGE_KEY) setAccent(normalizeAccent(event.newValue) || "neutral");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const accentStyles = useMemo(() => accentStyle(accent, dark), [accent, dark]);
  return { accent, setAccent, accentStyles };
}
