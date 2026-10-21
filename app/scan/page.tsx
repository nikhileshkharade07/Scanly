"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import BlobImage from "@/components/BlobImage";
import { scanlyApi } from "@/lib/api/scanly";
import { loadSettings } from "@/lib/settings";
import { db } from "@/lib/storage/db";
import { makeThumbnail } from "@/lib/utils/image";
import type { DetectResult, DocumentRecord, FilterId, ScanPage } from "@/types/scanner";

type Step = "capture" | "adjust" | "review";
type CameraState = "idle" | "starting" | "active" | "denied" | "unsupported";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "original", label: "Original" },
  { id: "grayscale", label: "Grayscale" },
  { id: "black-white", label: "B&W" },
  { id: "contrast", label: "Contrast" },
  { id: "sharpen", label: "Sharpen" },
];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [camera, setCamera] = useState<CameraState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [step, setStep] = useState<Step>("capture");
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [backendUp, setBackendUp] = useState(true);
  const [settings, setSettings] = useState(() => loadSettings());

  const activePage = pages[activePageIndex];

  useEffect(() => {
    setSettings(loadSettings());
    void scanlyApi.ping().then((info) => setBackendUp(Boolean(info)));
  }, []);

  // Release the live stream on unmount.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  // Revoke preview URLs on unmount.
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (processedUrl) URL.revokeObjectURL(processedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      return;
    }
    setCamera("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setStream(media);
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play().catch(() => undefined);
      }
      setCamera("active");
    } catch (error) {
      console.warn("Camera unavailable:", error);
      setCamera("denied");
    }
  }, []);

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setCamera("idle");
  }, [stream]);

  /** Grab the current camera frame as a JPEG blob. */
  const grabFrame = useCallback((): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return Promise.resolve(null);
    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(video, 0, 0, width, height);
    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92),
    );
  }, []);

  const adoptImage = useCallback(
    async (blob: Blob, source: "camera" | "file") => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      const url = URL.createObjectURL(blob);
      setOriginalUrl(url);
      setStep("adjust");

      const page: ScanPage = {
        id: crypto.randomUUID(),
        originalImage: blob,
        filter: settings.defaultFilter,
        status: "processing",
        createdAt: Date.now(),
      };
      setPages((prev) => {
        const next = [...prev, page];
        setActivePageIndex(next.length - 1);
        return next;
      });

      // Auto-detect document corners (best-effort; manual corners always available).
      if (backendUp) {
        setDetecting(true);
        try {
          const result: DetectResult = await scanlyApi.detect(blob);
          if (result.found && result.corners.length === 4) {
            setPages((prev) =>
              prev.map((p) => (p.id === page.id ? { ...p, corners: result.corners } : p)),
            );
          } else if (source === "camera") {
            setNotice("No document edges detected — adjust the corners manually.");
          }
        } catch (error) {
          console.warn("Detection failed:", error);
        } finally {
          setDetecting(false);
        }
      }
    },
    [backendUp, originalUrl, settings.defaultFilter],
  );

  const onCapture = useCallback(async () => {
    const blob = await grabFrame();
    if (!blob) {
      setNotice("Camera frame is not ready yet.");
      return;
    }
    await adoptImage(blob, "camera");
  }, [adoptImage, grabFrame]);

  const onPickFile = useCallback(
    async (file: File) => {
      await adoptImage(file, "file");
    },
    [adoptImage],
  );

  /** Live-processed preview for the active page. */
  const refreshPreview = useCallback(async () => {
    const page = pages[activePageIndex];
    if (!page || !backendUp) return;
    setProcessing(true);
    try {
      const blob = await scanlyApi.process(page.originalImage, {
        corners: page.corners ? page.corners.map(([x, y]) => [x, y]) : undefined,
        filter: page.filter,
        rotation: page.rotation ?? 0,
        maxWidth: 1800,
      });
      if (processedUrl) URL.revokeObjectURL(processedUrl);
      setProcessedUrl(URL.createObjectURL(blob));
      setPages((prev) =>
        prev.map((p) => (p.id === page.id ? { ...p, processedImage: blob, status: "ready" } : p)),
      );
    } catch (error) {
      console.error("Preview processing failed:", error);
      setNotice(error instanceof Error ? error.message : "Processing failed.");
    } finally {
      setProcessing(false);
    }
  }, [activePageIndex, backendUp, pages, processedUrl]);

  // Debounced preview refresh when the page or its settings change.
  useEffect(() => {
    if (step !== "adjust" || !activePage || !backendUp) return;
    const timer = setTimeout(() => void refreshPreview(), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.corners, activePage?.filter, activePage?.rotation, step, backendUp]);

  const updateActivePage = useCallback(
    (patch: Partial<ScanPage>) => {
      const page = pages[activePageIndex];
      if (!page) return;
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, ...patch } : p)));
    },
    [activePageIndex, pages],
  );

  /** Corner dragging on the preview canvas overlay. */
  const onOverlayPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const page = pages[activePageIndex];
      if (!page?.corners) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = clamp01((event.clientX - rect.left) / rect.width);
      const y = clamp01((event.clientY - rect.top) / rect.height);
      let nearest = 0;
      let best = Infinity;
      page.corners.forEach(([cx, cy], index) => {
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < best) {
          best = d;
          nearest = index;
        }
      });
      setDragIndex(nearest);
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    [activePageIndex, pages],
  );

  const onOverlayPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragIndex === null) return;
      const page = pages[activePageIndex];
      if (!page?.corners) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = clamp01((event.clientX - rect.left) / rect.width);
      const y = clamp01((event.clientY - rect.top) / rect.height);
      const corners = page.corners.map(([cx, cy], index) => (index === dragIndex ? ([x, y] as [number, number]) : ([cx, cy] as [number, number])));
      updateActivePage({ corners });
    },
    [activePageIndex, dragIndex, pages, updateActivePage],
  );

  const onOverlayPointerUp = useCallback(() => setDragIndex(null), []);

  const resetCorners = useCallback(() => updateActivePage({ corners: undefined }), [updateActivePage]);

  const acceptPage = useCallback(() => {
    setStep("review");
  }, []);

  const scanAnother = useCallback(() => {
    setStep("capture");
    setProcessedUrl(null);
    setOriginalUrl(null);
  }, []);

  /** Run OCR on all pages, persist the document, open its editor. */
  const finishDocument = useCallback(async () => {
    if (pages.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const lang = settings.ocrLanguage;
      const finished: ScanPage[] = [];
      for (const page of pages) {
        let ocr = page.ocr;
        if (!ocr && settings.autoOcr && backendUp) {
          try {
            ocr = await scanlyApi.ocr(page.processedImage ?? page.originalImage, lang);
          } catch (error) {
            console.warn("OCR failed for page:", error);
          }
        }
        const thumbnail = await makeThumbnail(page.processedImage ?? page.originalImage, 480);
        finished.push({ ...page, ocr, thumbnail, status: "ready" });
      }
      const searchableText = finished
        .map((page) => page.ocr?.text ?? "")
        .filter(Boolean)
        .join("\n\n");
      const now = Date.now();
      const record: DocumentRecord = {
        id: crypto.randomUUID(),
        title: `Scan ${new Date(now).toLocaleString()}`,
        pages: finished,
        searchableText,
        status: "saved",
        createdAt: now,
        updatedAt: now,
      };
      await db.documents.add(record);
      router.push(`/documents/${record.id}`);
    } catch (error) {
      console.error("Saving failed:", error);
      setNotice(error instanceof Error ? error.message : "Saving failed.");
    } finally {
      setBusy(false);
    }
  }, [backendUp, pages, router, settings.autoOcr, settings.ocrLanguage]);

  const removePage = useCallback(
    (index: number) => {
      setPages((prev) => {
        const next = prev.filter((_, i) => i !== index);
        setActivePageIndex((current) => Math.min(current, next.length - 1));
        return next;
      });
    },
    [],
  );

  const movePage = useCallback((index: number, delta: number) => {
    setPages((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const pagePreviewUrl = useMemo(() => {
    const page = pages[activePageIndex];
    if (!page) return null;
    return processedUrl ?? originalUrl;
  }, [activePageIndex, originalUrl, pages, processedUrl]);

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Scanner</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">New scan</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">
              Step {step === "capture" ? 1 : step === "adjust" ? 2 : 3} of 3 ·{" "}
              {step === "capture" ? "Capture" : step === "adjust" ? "Adjust" : "Review"}
            </span>
            <Link href="/" className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
              Exit
            </Link>
          </div>
        </header>

        {!backendUp && (
          <p className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
            The local processing engine is offline. Camera capture and drafts still work — run the
            C++ backend (<code className="font-mono">.\scripts\dev.ps1</code>) to enable detection, enhancement, OCR and PDF export.
          </p>
        )}
        {notice && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="ml-4 text-zinc-500 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {step === "capture" && (
          <section className="mt-6">
            <div className="relative mx-auto max-w-2xl overflow-hidden rounded-2xl border border-zinc-900 bg-black">
              <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover sm:aspect-[4/3]" />
              {camera !== "active" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/90 p-6 text-center">
                  {camera === "starting" ? (
                    <p className="text-zinc-400">Starting camera…</p>
                  ) : (
                    <>
                      <p className="max-w-sm text-zinc-400">
                        {camera === "denied"
                          ? "Camera access was denied. You can still upload an image, or re-enable camera permission in your browser settings."
                          : camera === "unsupported"
                            ? "This browser does not expose a camera API. Upload an image instead."
                            : "Point your camera at a document, or upload an image to scan."}
                      </p>
                      <div className="flex flex-wrap justify-center gap-3">
                        {camera !== "denied" && camera !== "unsupported" && (
                          <button onClick={() => void startCamera()} className="rounded-xl bg-white px-6 py-3 font-semibold text-zinc-950 hover:bg-zinc-200">
                            Enable camera
                          </button>
                        )}
                        <button onClick={() => fileRef.current?.click()} className="rounded-xl border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900">
                          Upload image
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-3">
              {camera === "active" && (
                <>
                  <button onClick={() => void onCapture()} className="rounded-xl bg-white px-7 py-3 font-semibold text-zinc-950 shadow-lg shadow-white/5 hover:bg-zinc-200">
                    Capture page
                  </button>
                  <button onClick={stopCamera} className="rounded-xl border border-zinc-800 px-6 py-3 font-semibold text-zinc-200 hover:bg-zinc-900">
                    Stop camera
                  </button>
                </>
              )}
              <button onClick={() => fileRef.current?.click()} className="rounded-xl border border-zinc-800 px-6 py-3 font-semibold text-zinc-200 hover:bg-zinc-900">
                Upload image
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPickFile(file);
                e.target.value = "";
              }}
            />
          </section>
        )}

        {step === "adjust" && activePage && (
          <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div>
              <div
                className="relative mx-auto max-w-2xl touch-none select-none overflow-hidden rounded-2xl border border-zinc-900 bg-black"
                onPointerDown={onOverlayPointerDown}
                onPointerMove={onOverlayPointerMove}
                onPointerUp={onOverlayPointerUp}
                onPointerCancel={onOverlayPointerUp}
              >
                {pagePreviewUrl && <img src={pagePreviewUrl} alt="Page preview" className="block w-full" />}
                {activePage.corners && (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    <polygon
                      points={activePage.corners.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
                      fill="rgba(34,197,94,0.08)"
                      stroke="#22c55e"
                      strokeWidth="0.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
                {activePage.corners &&
                  activePage.corners.map(([x, y], index) => (
                    <span
                      key={index}
                      className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500/80 shadow"
                      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                    />
                  ))}
                {(processing || detecting) && (
                  <div className="absolute bottom-3 left-3 rounded-md bg-black/70 px-3 py-1 text-xs text-emerald-300">
                    {detecting ? "Detecting document…" : "Processing…"}
                  </div>
                )}
              </div>
              <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-zinc-500">
                Drag the green handles onto the corners of your page. The live preview shows the corrected result.
              </p>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
                <h2 className="text-sm font-semibold text-zinc-300">Enhancement</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {FILTERS.map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => updateActivePage({ filter: filter.id })}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${
                        activePage.filter === filter.id
                          ? "border-white bg-white font-semibold text-zinc-950"
                          : "border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
                <h2 className="text-sm font-semibold text-zinc-300">Orientation</h2>
                <div className="mt-3 flex gap-2">
                  {[0, 90, 180, 270].map((degrees) => (
                    <button
                      key={degrees}
                      onClick={() => updateActivePage({ rotation: degrees as 0 | 90 | 180 | 270 })}
                      className={`flex-1 rounded-lg border px-2 py-2 text-sm ${
                        (activePage.rotation ?? 0) === degrees
                          ? "border-white bg-white font-semibold text-zinc-950"
                          : "border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                      }`}
                    >
                      {degrees}°
                    </button>
                  ))}
                </div>
                <button
                  onClick={resetCorners}
                  disabled={!activePage.corners}
                  className="mt-3 w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
                >
                  Reset corners to full frame
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={acceptPage}
                  disabled={processing}
                  className="flex-1 rounded-xl bg-white px-5 py-3 font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
                >
                  Accept page
                </button>
              </div>
            </aside>
          </section>
        )}

        {step === "review" && (
          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {pages.length} page{pages.length === 1 ? "" : "s"} ready
              </h2>
              <div className="flex flex-wrap gap-2">
                <button onClick={scanAnother} className="rounded-xl border border-zinc-800 px-5 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-900">
                  Add another page
                </button>
                <button
                  onClick={() => void finishDocument()}
                  disabled={busy}
                  className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
                >
                  {busy ? (settings.autoOcr && backendUp ? "Running OCR…" : "Saving…") : "Finish & save"}
                </button>
              </div>
            </div>

            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {pages.map((page, index) => (
                <li key={page.id} className="rounded-2xl border border-zinc-900 bg-zinc-950 p-3">
                  <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-zinc-900">
                    <BlobImage blob={page.processedImage ?? page.originalImage} className="h-full w-full object-cover" />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                    <span>Page {index + 1} · {FILTERS.find((f) => f.id === page.filter)?.label ?? page.filter}</span>
                    {page.ocr && <span className="text-emerald-400">OCR ✓</span>}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button onClick={() => movePage(index, -1)} disabled={index === 0} className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40">
                      ←
                    </button>
                    <button onClick={() => movePage(index, 1)} disabled={index === pages.length - 1} className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40">
                      →
                    </button>
                    <button
                      onClick={() => {
                        setActivePageIndex(index);
                        setStep("adjust");
                      }}
                      className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                    >
                      Edit
                    </button>
                    <button onClick={() => removePage(index)} className="ml-auto rounded border border-red-900/60 px-2 py-1 text-xs text-red-400 hover:bg-red-950/50">
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {!settings.autoOcr && (
              <p className="mt-4 text-sm text-zinc-500">
                OCR is disabled in settings — pages will be saved without a text layer. Enable
                auto-OCR in Settings for searchable documents.
              </p>
            )}
          </section>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </main>
  );
}
