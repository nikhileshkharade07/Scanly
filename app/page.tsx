"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import BlobImage from "@/components/BlobImage";
import { scanlyApi, type HealthInfo } from "@/lib/api/scanly";
import { loadSettings } from "@/lib/settings";
import { db } from "@/lib/storage/db";
import { formatBytes, makeThumbnail } from "@/lib/utils/image";
import type { DocumentRecord } from "@/types/scanner";

function BackendBadge({ health }: { health: HealthInfo | null | "loading" }) {
  if (health === "loading") {
    return <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-500">Checking engine…</span>;
  }
  if (!health) {
    return <span className="rounded-full border border-amber-900/60 bg-amber-950/40 px-3 py-1 text-xs text-amber-300">Engine offline</span>;
  }
  return (
    <span
      className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-3 py-1 text-xs text-emerald-400"
      title={`OpenCV ${health.engine.opencv} · Tesseract ${health.engine.tesseract} · Languages: ${health.languages.join(", ")}`}
    >
      Engine ready · OCR: {health.languages.join(", ")}
    </span>
  );
}

export default function HomePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<HealthInfo | null | "loading">("loading");
  const [recent, setRecent] = useState<DocumentRecord[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [info, docs] = await Promise.all([scanlyApi.ping(), db.documents.orderBy("updatedAt").reverse().limit(6).toArray()]);
    setHealth(info);
    setRecent(docs);
    let bytes = 0;
    for (const doc of docs) {
      for (const page of doc.pages) {
        bytes += page.originalImage?.size ?? 0;
        bytes += page.processedImage?.size ?? 0;
      }
    }
    setTotalBytes(bytes);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const thumbnail = await makeThumbnail(file, 480);
        // Draft flow: persist the raw upload as a single-page document and open the editor.
        const id = crypto.randomUUID();
        const now = Date.now();
        const record: DocumentRecord = {
          status: "draft",
          id,
          title: file.name.replace(/\.[a-z0-9]+$/i, "") || "Untitled scan",
          pages: [
            {
              id: crypto.randomUUID(),
              originalImage: file,
              thumbnail,
              filter: loadSettings().defaultFilter,
              status: "draft",
              createdAt: now,
            },
          ],
          searchableText: "",
          createdAt: now,
          updatedAt: now,
        };
        await db.documents.add(record);
        window.location.href = `/documents/${id}`;
      } catch (err) {
        console.error("Upload failed:", err);
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <div className="min-h-[calc(100vh-3.5rem)] px-5 py-10 text-zinc-100 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col">
        <header className="flex items-center justify-end">
          <BackendBadge health={health} />
        </header>

        <section className="mt-10 flex flex-col items-center justify-center text-center">
          <div className="mb-8 max-w-2xl animate-fade-in">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Scan documents.
              <br />
              Keep them yours.
            </h1>
            <p className="mx-auto mt-5 max-w-xl leading-7 text-zinc-400">
              Capture with your camera or upload an image, straighten the page, run OCR and export a
              searchable PDF. Everything is processed on this machine — no uploads, no accounts, no telemetry.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/scan"
              className="rounded-xl bg-emerald-500 px-7 py-4 font-semibold text-zinc-950 shadow-lg shadow-emerald-500/10 transition hover:bg-emerald-400"
            >
              Scan document
            </Link>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-xl border border-zinc-800 bg-zinc-950 px-7 py-4 font-semibold text-zinc-100 transition hover:bg-zinc-900 disabled:opacity-50"
            >
              {busy ? "Opening…" : "Upload document"}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Upload a document image"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onUpload(file);
              e.target.value = "";
            }}
          />
          {error && <p className="mt-4 text-sm text-red-400" role="alert">{error}</p>}

          <div className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
            {[
              ["Camera capture", "Live camera with document corner detection and manual adjustment."],
              ["Real OCR", "Tesseract runs locally with word-level boxes and confidence scores."],
              ["Searchable PDF", "Export with a selectable, invisible text layer positioned per word."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-xl border border-zinc-900 bg-zinc-950 p-5 transition hover:border-zinc-700">
                <h2 className="font-medium">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent documents</h2>
            <div className="flex items-center gap-3 text-sm text-zinc-500">
              {totalBytes > 0 && <span>≈ {formatBytes(totalBytes)} on this device</span>}
              <Link href="/library" className="text-zinc-300 hover:text-white">
                View all →
              </Link>
            </div>
          </div>
          {recent.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 p-10 text-center">
              <p className="text-zinc-400">No documents yet.</p>
              <p className="mt-2 text-sm text-zinc-600">Scan or upload your first page — it stays on this device.</p>
              <Link
                href="/scan"
                className="mt-6 inline-block rounded-xl border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 transition hover:bg-zinc-900"
              >
                Start scanning
              </Link>
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {recent.map((doc) => {
                const thumbUrl = doc.pages[0]?.thumbnail ?? doc.pages[0]?.processedImage ?? doc.pages[0]?.originalImage;
                return (
                  <li key={doc.id}>
                    <Link href={`/documents/${doc.id}`} className="group block rounded-xl border border-zinc-900 bg-zinc-950 p-3 transition hover:border-zinc-700">
                      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-zinc-900">
                        {thumbUrl ? (
                          <BlobImage blob={thumbUrl} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xs text-zinc-600">No preview</span>
                        )}
                      </div>
                      <p className="mt-2 truncate text-sm font-medium">{doc.title}</p>
                      <p className="text-xs text-zinc-500">
                        {doc.pages.length} page{doc.pages.length === 1 ? "" : "s"} ·{" "}
                        {new Date(doc.updatedAt).toLocaleDateString()}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
