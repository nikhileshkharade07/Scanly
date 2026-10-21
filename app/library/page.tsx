"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import BlobImage from "@/components/BlobImage";
import { scanlyApi, type PdfMeta } from "@/lib/api/scanly";
import { db } from "@/lib/storage/db";
import { includesSearchText } from "@/lib/search/text-search";
import { formatBytes } from "@/lib/utils/image";
import type { DocumentRecord } from "@/types/scanner";

type SortKey = "updated" | "created" | "title" | "pages";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[^\w\- ]+/g, "_").trim().replace(/\s+/g, "-");
  return cleaned || "scanly-document";
}

function LibraryInner() {
  const searchParams = useSearchParams();
  const exportTarget = searchParams.get("export");

  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backendUp, setBackendUp] = useState(false);

  const reload = useCallback(async () => {
    const all = await db.documents.orderBy("updatedAt").reverse().toArray();
    setDocs(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    void scanlyApi.ping().then((info) => setBackendUp(Boolean(info)));
  }, [reload]);

  const visible = useMemo(() => {
    const q = query.trim();
    const filtered = q
      ? docs.filter((doc) => includesSearchText(`${doc.title} ${doc.searchableText}`, q))
      : docs;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "created":
          return b.createdAt - a.createdAt;
        case "title":
          return a.title.localeCompare(b.title);
        case "pages":
          return b.pages.length - a.pages.length;
        case "updated":
        default:
          return b.updatedAt - a.updatedAt;
      }
    });
    return sorted;
  }, [docs, query, sort]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const deleteSelected = useCallback(async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} document(s)? This cannot be undone.`)) return;
    await Promise.all(Array.from(selected).map((id) => db.documents.delete(id)));
    setSelected(new Set());
    await reload();
  }, [reload, selected]);

  const deleteOne = useCallback(
    async (doc: DocumentRecord) => {
      if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
      await db.documents.delete(doc.id);
      await reload();
    },
    [reload],
  );

  const exportTxt = useCallback(
    (doc: DocumentRecord) => {
      const text = doc.pages
        .map((page, index) =>
          page.ocr?.text ? `--- Page ${index + 1} ---\n${page.ocr.text}` : `--- Page ${index + 1} (no text) ---`,
        )
        .join("\n\n");
      downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${sanitizeFilename(doc.title)}.txt`);
    },
    [],
  );

  const exportPdf = useCallback(
    async (doc: DocumentRecord) => {
      if (!backendUp) {
        setNotice("The processing engine is offline — start the C++ backend to export PDFs.");
        return;
      }
      setExportingId(doc.id);
      setNotice(null);
      try {
        const meta: PdfMeta = {
          title: doc.title,
          pages: doc.pages.map((page) => ({ ocr: page.ocr ?? null })),
        };
        const blobs = doc.pages.map((page) => page.processedImage ?? page.originalImage);
        const pdf = await scanlyApi.searchablePdf(meta, blobs);
        downloadBlob(pdf, `${sanitizeFilename(doc.title)}.pdf`);
      } catch (error) {
        console.error("PDF export failed:", error);
        setNotice(error instanceof Error ? error.message : "PDF export failed.");
      } finally {
        setExportingId(null);
      }
    },
    [backendUp],
  );

  // Auto-open export for a document linked from the editor.
  useEffect(() => {
    if (!exportTarget) return;
    const doc = docs.find((d) => d.id === exportTarget);
    if (doc && backendUp) void exportPdf(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportTarget, docs, backendUp]);

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
              Local library · nothing leaves this device
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Documents</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
              Home
            </Link>
            <Link href="/scan" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200">
              New scan
            </Link>
          </div>
        </header>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles and recognized text…"
            className="min-w-[240px] flex-1 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-zinc-500"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm outline-none focus:border-zinc-500"
          >
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
            <option value="title">Title (A–Z)</option>
            <option value="pages">Most pages</option>
          </select>
          {selected.size > 0 && (
            <button onClick={() => void deleteSelected()} className="rounded-xl border border-red-900/60 px-4 py-2.5 text-sm text-red-400 hover:bg-red-950/50">
              Delete {selected.size} selected
            </button>
          )}
        </div>

        {notice && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="ml-4 text-zinc-500 hover:text-white">✕</button>
          </div>
        )}

        {loading ? (
          <p className="mt-10 text-zinc-500">Loading documents…</p>
        ) : visible.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-zinc-800 p-12 text-center">
            <p className="text-zinc-400">
              {query ? `No documents match “${query}”.` : "Your library is empty."}
            </p>
            {!query && (
              <Link href="/scan" className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-semibold text-zinc-950">
                Scan your first document
              </Link>
            )}
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((doc) => {
              const preview = doc.thumbnail ?? doc.pages[0]?.processedImage ?? doc.pages[0]?.originalImage;
              const ocrPages = doc.pages.filter((page) => page.ocr).length;
              const size = doc.pages.reduce(
                (sum, page) => sum + (page.originalImage?.size ?? 0) + (page.processedImage?.size ?? 0),
                0,
              );
              return (
                <li key={doc.id} className={`rounded-2xl border bg-zinc-950 p-4 transition ${selected.has(doc.id) ? "border-emerald-700" : "border-zinc-900"}`}>
                  <div className="flex gap-4">
                    <Link href={`/documents/${doc.id}`} className="block w-24 shrink-0">
                      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-zinc-900">
                        {preview ? (
                          <BlobImage blob={preview} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[10px] text-zinc-600">No preview</span>
                        )}
                      </div>
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link href={`/documents/${doc.id}`} className="block">
                        <h2 className="truncate font-semibold hover:text-zinc-300">{doc.title}</h2>
                      </Link>
                      <p className="mt-1 text-xs text-zinc-500">
                        {doc.pages.length} page{doc.pages.length === 1 ? "" : "s"} · {ocrPages} with text ·{" "}
                        {formatBytes(size)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600">
                        Updated {new Date(doc.updatedAt).toLocaleString()}
                      </p>
                      {doc.searchableText && (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
                          {doc.searchableText.slice(0, 120)}…
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => void exportPdf(doc)}
                          disabled={exportingId === doc.id}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
                          title={backendUp ? "Searchable PDF with invisible OCR layer" : "Requires the local processing engine"}
                        >
                          {exportingId === doc.id ? "Exporting…" : "PDF"}
                        </button>
                        <button onClick={() => exportTxt(doc)} className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900">
                          TXT
                        </button>
                        <button onClick={() => toggleSelect(doc.id)} className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900">
                          {selected.has(doc.id) ? "Deselect" : "Select"}
                        </button>
                        <button onClick={() => void deleteOne(doc)} className="ml-auto rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50">
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-950 p-8 text-zinc-500">Loading…</main>}>
      <LibraryInner />
    </Suspense>
  );
}
