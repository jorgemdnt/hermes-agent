import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

const asDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error || new Error("Could not read recording"));
  reader.readAsDataURL(blob);
});

export function useMobileDictation(profile: string, session: string, onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const phaseRef = useRef<DictationPhase>("idle");
  const current = useRef<{ recorder: MediaRecorder; stream: MediaStream } | null>(null);
  const generation = useRef(0);
  const update = (next: DictationPhase) => { phaseRef.current = next; setPhase(next); };
  const discard = useCallback(() => {
    generation.current++;
    const take = current.current;
    current.current = null;
    if (take && take.recorder.state !== "inactive") take.recorder.stop();
    take?.stream.getTracks().forEach(track => track.stop());
    phaseRef.current = "idle";
    setPhase("idle");
  }, []);
  useEffect(() => discard, [profile, session, discard]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && current.current?.recorder.state === "recording") {
        phaseRef.current = "transcribing";
        setPhase("transcribing");
        current.current.recorder.stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const start = async () => {
    if (phaseRef.current !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Microphone recording is unavailable in this browser");
      return;
    }
    const ticket = ++generation.current;
    update("starting");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation.current !== ticket) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = ["audio/mp4", "audio/webm", "audio/ogg"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (generation.current !== ticket) return;
        discard(); update("idle"); toast.error("Recording failed. Try again.");
      };
      recorder.onstop = async () => {
        stream?.getTracks().forEach(track => track.stop());
        if (generation.current !== ticket) return;
        current.current = null;
        const audio = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" });
        if (!audio.size || audio.size > 25 * 1024 * 1024) {
          update("idle"); toast.error(audio.size ? "Recording exceeds 25 MB" : "No audio recorded"); return;
        }
        update("transcribing");
        try {
          const result = await api.transcribeAudio(await asDataUrl(audio), audio.type, profile);
          if (generation.current !== ticket) return;
          if (result.transcript.trim()) onTranscript(result.transcript.trim());
          else toast.message("No speech heard");
        } catch (error) {
          if (generation.current === ticket) toast.error(error instanceof Error ? error.message : "Could not transcribe audio");
        } finally { if (generation.current === ticket) update("idle"); }
      };
      recorder.start();
      current.current = { recorder, stream };
      update("recording");
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (generation.current !== ticket) return;
      update("idle");
      toast.error(error instanceof Error ? error.message : "Could not access microphone");
    }
  };
  const stop = () => {
    if (current.current?.recorder.state !== "recording") return;
    update("transcribing");
    current.current.recorder.stop();
  };
  return { phase, start, stop };
}
