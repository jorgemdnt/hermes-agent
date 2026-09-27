import { useEffect, useRef, useState, type RefObject } from "react";

interface Gesture { x: number; y: number; at: number; distance: number; cancelled: boolean }

export function useStandaloneSwipeBack(shell: RefObject<HTMLDivElement | null>, view: string, goBack: () => void, enabled: boolean, onCommit: () => void = () => {}) {
  const [swiping, setSwiping] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    const element = shell.current;
    if (!element || !enabled || view === "bots" ||
        !(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone)) return;
    let gesture: Gesture | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const panel = () => element.querySelector<HTMLElement>(".m-view:not([aria-hidden])");
    const position = (distance: number, animate = false) => {
      const current = panel();
      if (current) {
        current.style.transition = animate && !reducedMotion ? "transform 180ms ease-out" : "none";
        current.style.transform = `translate3d(${distance}px, 0, 0)`;
        current.style.boxShadow = distance ? "-12px 0 32px var(--shadow)" : "none";
      }
      if (preview.current) preview.current.style.transform = `translate3d(${(distance / element.clientWidth - 1) * 24}%, 0, 0)`;
    };
    const clear = () => { setSwiping(false); const current = panel(); if (current) { current.style.transition = ""; current.style.transform = ""; current.style.boxShadow = ""; } if (preview.current) preview.current.style.transform = ""; };
    const reset = () => {
      gesture = null;
      if (reducedMotion) clear();
      else { position(0, true); timeout = setTimeout(clear, 180); }
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || event.touches[0].clientX >= 24 || element.querySelector('[role="dialog"]')) return;
      const touch = event.touches[0];
      gesture = { x: touch.clientX, y: touch.clientY, at: performance.now(), distance: 0, cancelled: false };
      setSwiping(true);
    };
    const move = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.x;
      if (Math.abs(touch.clientY - gesture.y) > Math.max(12, dx)) { gesture.cancelled = true; return; }
      if (gesture.cancelled || dx < 8) return;
      event.preventDefault();
      gesture.distance = Math.min(element.clientWidth, dx);
      position(gesture.distance);
    };
    const end = () => {
      if (!gesture) return;
      const { distance, at } = gesture;
      gesture = null;
      if (distance >= element.clientWidth * .35 || (distance > 60 && distance / Math.max(1, performance.now() - at) > .55)) {
        commit.current();
        if (reducedMotion) { goBack(); setSwiping(false); }
        else { position(element.clientWidth, true); timeout = setTimeout(() => { goBack(); setSwiping(false); }, 180); }
      } else reset();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", reset);
    return () => {
      clearTimeout(timeout);
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", reset);
    };
  }, [shell, view, goBack, enabled]);
  return { swiping, preview };
}
