"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import BlobImage from "@/components/BlobImage";
import { db } from "@/lib/storage/db";
import type { DocumentRecord } from "@/types/scanner";

/** Chronological view of everything saved on this device, newest first. */
export default function HistoryPage() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const docs = await db.documents.orderBy("updatedAt").reverse().toArray();
      setDocuments(docs);
    } catch (err) {
      console.error("History load failed:", err);
      setError("Could not read your scan history from this browser's storage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = new Map<string, DocumentRecord[]>();
  for (const doc of documents) {
    const day = new Date(doc.updatedAt).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const bucket = byDay.get(day) ?? [];
    bucket.push(doc);
    byDay.set(day, bucket);
  }

  return (
    <div className="px-5 py-10 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Timeline</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Scan history</h1>
          </div>
          <Link href="/library" className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900">
            Grid view
          </Link>
        </header>

        {loading ? (
          <p className="mt-10 text-zinc-500">Loading history…</p>
        ) : error ? (
          <div className="mt-10 rounded-2xl border border-red-900/60 bg-red-950/30 p-8 text-center">
            <p className="text-red-400">{error}</p>
            <button onClick={() => void load()} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900">
              Try again
            </button>
          </div>
        ) : documents.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-zinc-800 p-12 text-center">
            <p className="text-zinc-400">Nothing scanned yet.</p>
            <Link href="/scan" className="mt-6 inline-block rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400">
              Scan your first document
            </Link>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {Array.from(byDay.entries()).map(([day, docs]) => (
              <section key={day}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{day}</h2>
                <ul className="mt-3 space-y-2">
                  {docs.map((doc) => {
                    const thumb = doc.pages[0]?.thumbnail ?? doc.pages[0]?.processedImage ?? doc.pages[0]?.originalImage;
                    const time = new Date(doc.updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                    return (
                      <li key={doc.id}>
                        <Link href={`/documents/${doc.id}`} className="flex items-center gap-4 rounded-xl border border-zinc-900 bg-zinc-950 p-3 transition hover:border-zinc-700">
                          <div className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-900">
                            {thumb ? <BlobImage blob={thumb} className="h-full w-full object-cover" /> : <span className="text-[10px] text-zinc-600">—</span>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{doc.title}</p>
                            <p className="text-xs text-zinc-500">
                              {time} · {doc.pages.length} page{doc.pages.length === 1 ? "" : "s"}
                              {doc.searchableText ? " · has text" : ""}
                            </p>
                          </div>
                          <span className="text-zinc-600" aria-hidden>→</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
