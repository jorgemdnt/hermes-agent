import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import { bindHistoryMouseNavigation, historyKeyDirection } from "@hermes/shared";
import { ArrowLeft, ArrowRight } from "lucide-react";
import "./navigation.css";

/** Router entries include browser URLs: the webview does not own a second stack. */
export function useMobileNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const action = useNavigationType();
  const index = window.history.state?.idx ?? 0;
  const ceiling = useRef(index);
  const previousKey = useRef(location.key);
  const [, redraw] = useState(0);
  if (previousKey.current !== location.key) {
    if (action === "PUSH") ceiling.current = index;
    else ceiling.current = Math.max(ceiling.current, index);
    previousKey.current = location.key;
  }
  const back = useCallback(() => { if ((window.history.state?.idx ?? 0) > 0) void navigate(-1); }, [navigate]);
  const forward = useCallback(() => { if ((window.history.state?.idx ?? 0) < ceiling.current) void navigate(1); }, [navigate]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const direction = historyKeyDirection(event);
      if (direction === null) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (direction === -1) back(); else forward();
    };
    const pop = () => redraw(value => value + 1);
    window.addEventListener("keydown", key, true);
    const unbindMouse = bindHistoryMouseNavigation(window, direction => { if (direction === -1) back(); else forward(); });
    window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("keydown", key, true); unbindMouse(); window.removeEventListener("popstate", pop); };
  }, [back, forward]);
  return { back, forward, canGoBack: index > 0, canGoForward: index < ceiling.current };
}

export function HistoryButtons({ back, forward, canGoBack, canGoForward }: ReturnType<typeof useMobileNavigation>) {
  return <nav className="m-history" aria-label="Navigation history">
    <button type="button" className="m-icon-button" aria-label="Go back" title="Back (⌘[ / Ctrl+[)" disabled={!canGoBack} onClick={back}><ArrowLeft size={18} /></button>
    <button type="button" className="m-icon-button" aria-label="Go forward" title="Forward (⌘] / Ctrl+])" disabled={!canGoForward} onClick={forward}><ArrowRight size={18} /></button>
  </nav>;
}
