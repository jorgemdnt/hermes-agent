import { useEffect } from "react";

const ENTRY_RE = /assets\/index-[^"']+\.js/;

/** The bundle entry this page is running. */
export function currentEntry(doc: Document = document): string | null {
  for (const s of Array.from(doc.scripts)) {
    const m = ENTRY_RE.exec(s.src);
    if (m) return m[0];
  }
  return null;
}

/** The bundle entry the server serves now, or null when unknown. */
export function servedEntry(html: string): string | null {
  return ENTRY_RE.exec(html)?.[0] ?? null;
}

/**
 * Reload into a newer build when the server has one, but only while the user
 * isn't mid-thought: `idle()` must say nothing is typed or sending.
 */
export function useLatestBuild(indexUrl: string, idle: () => boolean, everyMs = 60_000) {
  useEffect(() => {
    const running = currentEntry();
    if (!running) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const res = await fetch(indexUrl, { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) return;
        const served = servedEntry(await res.text());
        if (served && served !== running && idle()) window.location.reload();
      } catch { /* offline: try again next tick */ }
    };
    const timer = window.setInterval(check, everyMs);
    const onShow = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", onShow); };
  }, [indexUrl, idle, everyMs]);
}
