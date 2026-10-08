"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Tesseract, { recognize } from "tesseract.js";
import { jsPDF } from "jspdf";
import { db } from "@/lib/storage/db";
import type { OCRResult, ScanPage, DocumentRecord } from "@/types/scanner";
import type { LoggerMessage, RecognizeResult as TessResult } from "tesseract.js";

export default function ScanPage() {
  const { docId } = useParams<{ docId?: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ status: string; progress: number } | null>(null);
  const [ocrText, setOcrText] = useState<string>("");
  const [showResult, setShowResult] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [docIdState, setDocIdState] = useState<string | null>(null);

  // Load document if docId is provided
  useEffect(() => {
    if (docId) {
      setDocIdState(docId);
      loadDocument(docId);
    }
  }, [docId]);

  // Load document from Dexie
  const loadDocument = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const doc = await db.documents.get(id);
      if (doc && doc.pages.length > 0) {
        const page = doc.pages[0];
        setOcrText(page.ocr?.text || "");
        setShowResult(true);
        setLoading(false);
        // Also set image if available (though we won't display it in view mode)
        if (page.originalImage) {
          setImageUrl(URL.createObjectURL(page.originalImage));
        }
      } else {
        setError("Document not found");
        setLoading(false);
      }
    } catch (err) {
      setError("Failed to load document");
      setLoading(false);
      console.error("Document load error:", err);
    }
  };

  // Camera handling
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

  const handleCapture = async () => {
    if (!videoRef.current) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          setImageUrl(URL.createObjectURL(blob));
          setError(null);
          startOcr(blob);
        } else {
          setError("Failed to capture image");
        }
      }, "image/png");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }
    setError(null);
    setImageUrl(URL.createObjectURL(file));
    startOcr(file);
  };

  const startOcr = async (image: Blob | File) => {
    setLoading(true);
    setProgress({ status: "Initializing", progress: 0 });
    setOcrText("");
    setShowResult(false);
    setCopySuccess(false);
    try {
      const result = await recognize(image, "eng", {
        logger: (m) => {
          // Map Tesseract progress status to our own messages
          let status = "";
          switch (m.status) {
            case "loading":
              status = "Loading model";
              break;
            case "recognizing text":
              status = "Recognizing text";
              break;
            case "loading finished":
              status = "Almost done";
              break;
            default:
              status = m.status;
          }
          setProgress({ status, progress: Math.round(m.progress * 100) });
        },
      });
      const text = result.data.text.trim();
      if (text === "") {
        setError("No text detected in the image");
        setLoading(false);
        return;
      }
      setOcrText(text);
      setShowResult(true);
      setLoading(false);
      // Save to history
      await saveScan(image, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed");
      setLoading(false);
    }
  };

  const saveScan = async (imageBlob: Blob | File, text: string) => {
    try {
      const scanPage: ScanPage = {
        id: crypto.randomUUID(),
        originalImage: imageBlob instanceof Blob ? imageBlob : new Blob([await (imageBlob as Blob).arrayBuffer()], { type: (imageBlob as Blob).type }),
        processedImage: undefined,
        corners: undefined,
        filter: "original",
        ocr: {
          text,
          confidence: 0, // We don't have confidence from Tesseract.js easily, but we can compute if needed
          blocks: [], // We don't have block structure from simple recognition
        },
        createdAt: Date.now(),
      };
      const doc: DocumentRecord = {
        id: crypto.randomUUID(),
        title: `Scan — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        pages: [scanPage],
        searchableText: text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.documents.add(doc);
    } catch (err) {
      console.error("Failed to save scan:", err);
      // Don't fail the UI if saving fails
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(ocrText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
      setError("Failed to copy text");
    }
  };

  const downloadTxt = () => {
    const blob = new Blob([ocrText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scanly-result.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const maxWidth = pageWidth - 2 * margin;
      const lineHeight = 8; // pt
      const lines = doc.splitTextToSize(ocrText, maxWidth);
      let y = margin;
      for (const line of lines) {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += lineHeight;
      }
      doc.save("scanly-result.pdf");
    } catch (err) {
      console.error("PDF export failed:", err);
      setError("Failed to export PDF");
    }
  };

  if (loading && !showResult) {
    return (
      <main className="min-h-screen bg-black p-4">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl flex-col items-center justify-center">
          <header className="mb-4">
            <a href="/" className="text-sm text-zinc-400 hover:text-white">← Back</a>
            <span className="font-medium">Scanning document</span>
          </header>
          {imageUrl && <img src={imageUrl} alt="Scanned" className="max-w-xl rounded-lg mb-4" />}
          {progress && (
            <div className="text-center text-zinc-400">
              <p className="font-medium">{progress.status}</p>
              <p className="mt-2">{progress.progress}%</p>
            </div>
          )}
          <button
            onClick={() => {
              setImageUrl(null);
              setLoading(false);
              setProgress(null);
            }}
            className="mt-6 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Cancel
          </button>
        </div>
      </main>
    );
  }

  if (error && !showResult) {
    return (
      <main className="min-h-screen bg-black p-4">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl flex-col items-center justify-center">
          <header className="mb-4">
            <a href="/" className="text-sm text-zinc-400 hover:text-white">← Back</a>
            <span className="font-medium">Scan document</span>
          </header>
          <div className="text-center">
            <p className="font-medium text-red-400">Error</p>
            <p className="mt-2 text-sm text-zinc-400">{error}</p>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setError(null)}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Try again
            </button>
            <a href="/" className="rounded-lg bg-white px-4 py-2 font-semibold text-zinc-950 shadow-lg shadow-white/5 transition hover:bg-zinc-200">
              Back to home
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black p-4">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between border-b border-zinc-900 px-5 py-4">
          <a href="/" className="text-sm text-zinc-400 hover:text-white">← Back</a>
          <span className="font-medium">Scan document</span>
          <span className="w-10" />
        </header>

        {!showResult ? (
          <>
            <section className="relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-900">
              {imageUrl && <img src={imageUrl} alt="Preview" className="h-full max-h-[75vh] w-full object-contain" />}
              <video ref={videoRef} autoPlay playsInline muted className="h-full max-h-[75vh] w-full object-cover" />
              <div className="pointer-events-none absolute inset-[10%] rounded-xl border-2 border-white/60" />
              {error && (
                <div className="absolute mx-6 max-w-md rounded-xl border border-zinc-700 bg-zinc-950/95 p-5 text-center">
                  <p className="font-medium">Error</p>
                  <p className="mt-2 text-sm text-zinc-400">{error}</p>
                </div>
              )}
            </section>
            <footer className="flex items-center justify-center gap-4 border-t border-zinc-900 p-5">
              <label className="cursor-pointer rounded-xl border border-zinc-700 px-5 py-3 text-sm">
                Upload
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </label>
              <button
                onClick={handleCapture}
                className="h-16 w-16 rounded-full border-4 border-zinc-700 bg-white"
                aria-label="Capture document"
              />
            </footer>
          </>
        ) : (
          <section className="flex-1 flex-col overflow-y-auto p-6">
            <div className="mb-4">
              <textarea
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                className="w-full min-h-[200px] p-3 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 resize-y focus:outline-none focus:ring-2 focus:ring-zinc-600"
                placeholder="OCR result will appear here..."
              />
            </div>
            <div className="flex flex-wrap gap-3 mb-4">
              <button
                onClick={copyText}
                disabled={!ocrText.trim()}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  copySuccess
                    ? "bg-green-600 text-white"
                    : "border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                }`}
              >
                {copySuccess ? "Copied!" : "Copy text"}
              </button>
              <button
                onClick={downloadTxt}
                disabled={!ocrText.trim()}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-900"
              >
                Download TXT
              </button>
              <button
                onClick={exportPdf}
                disabled={!ocrText.trim()}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-900"
              >
                Export PDF
              </button>
              <button
                onClick={() => {
                  setImageUrl(null);
                  setOcrText("");
                  setShowResult(false);
                }}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-900 ml-auto"
              >
                Scan another
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
