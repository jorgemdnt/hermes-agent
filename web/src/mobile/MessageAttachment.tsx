import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";
import { authedFetch } from "@/lib/api";

interface MessageAttachmentProps {
  src: string;
  name: string;
}

export function MessageFile({ src, name }: MessageAttachmentProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    setPending(true); setError("");
    try {
      const response = await authedFetch(src);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed");
    } finally { setPending(false); }
  };
  return <>
    <button type="button" className="m-image-ref" disabled={pending} onClick={() => void download()}><FileUp size={16} aria-hidden="true" />{name}</button>
    {error && <small role="status">{error}</small>}
  </>;
}

export function MessageImage({ src, name }: MessageAttachmentProps) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    // Image tags cannot send the loopback session header; use the same
    // authenticated binary fetch as gated-cookie downloads and previews.
    const load = async () => {
      try {
        const response = await authedFetch(src, { signal: controller.signal });
        if (!response.ok) throw new Error(`Image failed (${response.status})`);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (failed) return <MessageFile src={src} name={name} />;
  if (!url) return <span className="m-image-ref" role="status">Loading {name}…</span>;
  return <a className="m-image-attachment" href={url} target="_blank" rel="noreferrer" aria-label={`Open image ${name}`}>
    <img src={url} alt={name} onError={() => setFailed(true)} />
  </a>;
}
