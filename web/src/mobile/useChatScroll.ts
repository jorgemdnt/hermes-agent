import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from "react";

const BOTTOM_THRESHOLD = 56;

export function useChatScroll(identity: string, content: string) {
  const container = useRef<HTMLDivElement>(null);
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
    setPosition({ identity, atBottom: bottom });
  }, [identity]);

  useLayoutEffect(() => {
    anchored.current = true;
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [identity]);
  useLayoutEffect(() => {
    if (anchored.current && container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [content]);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (anchored.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [identity]);

  return { container, atBottom, onScroll, scrollToLatest };
}
