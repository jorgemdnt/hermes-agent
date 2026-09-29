import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { animate, type MotionValue } from "motion/react";

interface Gesture { x: number; y: number; at: number; distance: number; origin: number; cancelled: boolean }

export const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function useStandaloneSwipeBack(shell: RefObject<HTMLDivElement | null>, view: string, goBack: () => void, enabled: boolean, offset: MotionValue<number | string>, onCommit: () => void = () => {}) {
  const [swiping, setSwiping] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    const element = shell.current;
    if (!element || !enabled || view === "bots" || isIOSDevice() ||
        !(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone)) return;
    let gesture: Gesture | null = null;
    let alive = true;
    let committing = false;
    let animation: ReturnType<typeof animate> | undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const panel = () => element.querySelector<HTMLElement>(".m-detail:not([aria-hidden])");
    const position = (distance: number) => {
      offset.set(distance);
      const current = panel();
      if (current) current.style.boxShadow = distance ? "-12px 0 32px var(--shadow)" : "";
      if (preview.current) preview.current.style.transform = `translate3d(${(distance / element.clientWidth - 1) * 24}%, 0, 0)`;
    };
    const clear = () => {
      offset.set(0);
      setSwiping(false);
      const current = panel();
      if (current) current.style.boxShadow = "";
      if (preview.current) preview.current.style.transform = "";
    };
    const reset = () => {
      if (committing) return;
      gesture = null;
      if (reducedMotion) clear();
      else {
        const settling = animate(offset, 0, { duration: .18, ease: "easeOut" });
        animation = settling;
        void settling.then(() => { if (alive && animation === settling) clear(); });
      }
    };
    const start = (event: TouchEvent) => {
      if (committing || event.touches.length !== 1 || event.touches[0].clientX >= 24 || element.querySelector('[role="dialog"]')) return;
      animation?.stop();
      animation = undefined;
      offset.stop(); // Motion's enter animation must not overwrite the finger's position.
      const current = offset.get();
      const origin = typeof current === "string" && current.endsWith("%")
        ? parseFloat(current) * element.clientWidth / 100 : Number(current) || 0;
      const touch = event.touches[0];
      gesture = { x: touch.clientX, y: touch.clientY, at: performance.now(), distance: 0, origin, cancelled: false };
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
      position(Math.min(element.clientWidth, gesture.origin + gesture.distance));
    };
    const end = () => {
      if (!gesture) return;
      const { distance, at } = gesture;
      gesture = null;
      if (distance >= element.clientWidth * .35 || (distance > 60 && distance / Math.max(1, performance.now() - at) > .55)) {
        committing = true;
        commit.current();
        if (reducedMotion) goBack();
        else {
          const settling = animate(offset, element.clientWidth, { duration: .18, ease: "easeOut" });
          animation = settling;
          void settling.then(() => { if (alive && animation === settling) goBack(); });
        }
      } else reset();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", reset);
    return () => {
      alive = false;
      animation?.stop();
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", reset);
    };
  }, [shell, view, goBack, enabled, offset]);
  const finish = useCallback(() => {
    if (preview.current) preview.current.style.transform = "";
    setSwiping(false);
  }, []);
  return { swiping, preview, finish };
}
