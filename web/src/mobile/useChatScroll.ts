import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from "react";

const BOTTOM_THRESHOLD = 56;

export function useChatScroll(identity: string, content: string, active = true) {
  const container = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const [position, setPosition] = useState({ identity, atBottom: true });
  const atBottom = position.identity !== identity || position.atBottom;
  const anchored = useRef(true);
  const scrollToLatest = useCallback(() => {
    anchored.current = true;
    setPosition({ identity, atBottom: true });
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [identity]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_THRESHOLD;
    anchored.current = bottom;
    if (bottom) positions.current.delete(identity);
    else positions.current.set(identity, node.scrollTop);
    setPosition(prev => prev.identity === identity && prev.atBottom === bottom ? prev : { identity, atBottom: bottom });
  }, [identity]);

  useLayoutEffect(() => {
    if (!active || !container.current) return;
    const saved = positions.current.get(identity);
    anchored.current = saved === undefined;
    container.current.scrollTop = saved ?? container.current.scrollHeight;
    setPosition({ identity, atBottom: saved === undefined });
  }, [identity, active]);
  useLayoutEffect(() => {
    if (anchored.current && container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [content]);
  useLayoutEffect(() => {
    const node = container.current;
    if (!active || !node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (anchored.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [identity, active]);

  return { container, atBottom, onScroll, scrollToLatest };
}
