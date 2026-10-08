"use client";
import { useEffect, useRef, useState } from "react";
export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | undefined;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported by this browser.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to access the camera."); }
    })();
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, []);
  return <main className="min-h-screen bg-black p-4"><div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950">
    <header className="flex items-center justify-between border-b border-zinc-900 px-5 py-4"><a href="/" className="text-sm text-zinc-400 hover:text-white">← Back</a><span className="font-medium">Scan document</span><span className="w-10" /></header>
    <section className="relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-900"><video ref={videoRef} autoPlay playsInline muted className="h-full max-h-[75vh] w-full object-cover" /><div className="pointer-events-none absolute inset-[10%] rounded-xl border-2 border-white/60" />{error && <div className="absolute mx-6 max-w-md rounded-xl border border-zinc-700 bg-zinc-950/95 p-5 text-center"><p className="font-medium">Camera unavailable</p><p className="mt-2 text-sm text-zinc-400">{error} Use the upload fallback when camera APIs are unavailable.</p></div>}</section>
    <footer className="flex items-center justify-center gap-4 border-t border-zinc-900 p-5"><label className="cursor-pointer rounded-xl border border-zinc-700 px-5 py-3 text-sm">Upload<input type="file" accept="image/*" className="hidden" /></label><button className="h-16 w-16 rounded-full border-4 border-zinc-700 bg-white" aria-label="Capture document" /></footer>
  </div></main>;
}
