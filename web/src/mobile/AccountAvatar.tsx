import { useEffect, useState } from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

const RETRY_DELAYS = [1000, 5000, 30000];

interface AccountAvatarProps {
  picture: string;
  name: string;
}

export function AccountAvatar({ picture, name }: AccountAvatarProps) {
  const [attempt, setAttempt] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!picture || !failed || attempt >= RETRY_DELAYS.length) return;
    const timer = window.setTimeout(() => setAttempt(n => n + 1), RETRY_DELAYS[attempt]);
    return () => window.clearTimeout(timer);
  }, [picture, failed, attempt]);

  useEffect(() => {
    if (!picture || !failed) return;
    const retry = () => { setAttempt(0); setGeneration(n => n + 1); };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => { window.removeEventListener("online", retry); window.removeEventListener("focus", retry); };
  }, [picture, failed]);

  const src = generation || attempt ? `${picture}${picture.includes("?") ? "&" : "?"}retry=${generation}-${attempt}` : picture;
  return <AvatarPrimitive.Root className="m-avatar">
    {picture && <AvatarPrimitive.Image src={src} alt="" width={34} height={34} className="m-avatar"
      onLoadingStatusChange={status => setFailed(status === "error")} />}
    <AvatarPrimitive.Fallback className="m-avatar-fallback" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>;
}
