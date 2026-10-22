"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import BlobImage from "@/components/BlobImage";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { scanlyApi } from "@/lib/api/scanly";
import { loadSettings } from "@/lib/settings";
import { db } from "@/lib/storage/db";
import { formatBytes, makeThumbnail } from "@/lib/utils/image";
import type { DocumentRecord, OCRResult, ScanPage } from "@/types/scanner";

export default function DocumentEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const documentId = params?.id;

  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyPageIndex, setBusyPageIndex] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTextIndex, setEditingTextIndex] = useState<number | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"processed" | "original">("processed");

  const backendHealth = useBackendHealth();
  const backendUp = backendHealth !== null && backendHealth !== "loading";

  const reload = useCallback(async () => {
    if (!documentId) return;
    const record = await db.documents.get(documentId);
    if (!record) {
      setNotFound(true);
    } else {
      setDoc(record);
      setTitleDraft(record.title);
    }
    setLoading(false);
  }, [documentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(
    async (next: DocumentRecord) => {
      next.updatedAt = Date.now();
      await db.documents.update(next.id, {
        title: next.title,
        pages: next.pages,
        searchableText: next.searchableText,
        thumbnail: next.thumbnail,
        updatedAt: next.updatedAt,
      });
      setDoc(next);
    },
    [],
  );

  const rebuildText = useCallback((pages: ScanPage[]): string => {
    return pages
      .map((page) => page.ocr?.text ?? "")
      .filter(Boolean)
      .join("\n\n");
  }, []);

  const saveTitle = useCallback(async () => {
    if (!doc) return;
    const title = titleDraft.trim() || "Untitled document";
    await persist({ ...doc, title });
    setEditingTitle(false);
  }, [doc, persist, titleDraft]);

  const runOcr = useCallback(
    async (index: number) => {
      if (!doc) return;
      const page = doc.pages[index];
      if (!page) return;
      setBusyPageIndex(index);
      setNotice(null);
      try {
        const result: OCRResult = await scanlyApi.ocr(
          page.processedImage ?? page.originalImage,
          loadSettings().ocrLanguage,
        );
        const pages = doc.pages.map((p, i) =>
          i === index ? { ...p, ocr: result, ocrError: undefined, ocrLanguage: loadSettings().ocrLanguage } : p,
        );
        const thumbnail = await makeThumbnail(page.processedImage ?? page.originalImage, 480);
        await persist({ ...doc, pages, searchableText: rebuildText(pages), thumbnail });
      } catch (error) {
        console.error("OCR failed:", error);
        const message = error instanceof Error ? error.message : "OCR failed.";
        const pages = doc.pages.map((p, i) => (i === index ? { ...p, ocrError: message } : p));
        await persist({ ...doc, pages });
        setNotice(`Page ${index + 1}: ${message}`);
      } finally {
        setBusyPageIndex(null);
      }
    },
    [doc, persist, rebuildText],
  );

  const saveEditedText = useCallback(async () => {
    if (!doc || editingTextIndex === null) return;
    const pages = doc.pages.map((page, i) =>
      i === editingTextIndex && page.ocr ? { ...page, ocr: { ...page.ocr, text: textDraft } } : page,
    );
    await persist({ ...doc, pages, searchableText: rebuildText(pages) });
    setEditingTextIndex(null);
  }, [doc, editingTextIndex, persist, rebuildText, textDraft]);

  const deletePage = useCallback(
    async (index: number) => {
      if (!doc) return;
      if (doc.pages.length === 1) {
        if (!window.confirm("Delete this document? This cannot be undone.")) return;
        await db.documents.delete(doc.id);
        router.push("/library");
        return;
      }
      if (!window.confirm(`Delete page ${index + 1}?`)) return;
      const pages = doc.pages.filter((_, i) => i !== index);
      await persist({ ...doc, pages, searchableText: rebuildText(pages) });
    },
    [doc, persist, rebuildText, router],
  );

  const deleteDocument = useCallback(async () => {
    if (!doc) return;
    if (!window.confirm(`Delete "${doc.title}" and all its pages? This cannot be undone.`)) return;
    await db.documents.delete(doc.id);
    router.push("/library");
  }, [doc, router]);

  const reprocessPage = useCallback(
    async (index: number) => {
      if (!doc) return;
      const page = doc.pages[index];
      if (!page) return;
      setBusyPageIndex(index);
      setNotice(null);
      try {
        const blob = await scanlyApi.process(page.originalImage, {
          corners: page.corners,
          filter: page.filter,
          rotation: page.rotation ?? 0,
          maxWidth: 1800,
        });
        const pages = doc.pages.map((p, i) => (i === index ? { ...p, processedImage: blob } : p));
        const thumbnail = await makeThumbnail(blob, 480);
        await persist({ ...doc, pages, thumbnail });
      } catch (error) {
        console.error("Reprocessing failed:", error);
        setNotice(error instanceof Error ? error.message : "Reprocessing failed.");
      } finally {
        setBusyPageIndex(null);
      }
    },
    [doc, persist],
  );

  const addPagesViaFiles = useCallback(
    async (files: FileList) => {
      if (!doc || files.length === 0) return;
      setSaving(true);
      setNotice(null);
      try {
        let pages = [...doc.pages];
        for (const file of Array.from(files)) {
          const id = crypto.randomUUID();
          const page: ScanPage = {
            id,
            originalImage: file,
            filter: loadSettings().defaultFilter,
            createdAt: Date.now(),
            status: "draft",
          };
          try {
            page.processedImage = await scanlyApi.process(file, { filter: page.filter, maxWidth: 1800 });
            if (loadSettings().autoOcr) {
              page.ocr = await scanlyApi.ocr(page.processedImage, loadSettings().ocrLanguage);
              page.ocrLanguage = loadSettings().ocrLanguage;
            }
          } catch (error) {
            console.warn("Processing added page failed:", error);
          }
          page.thumbnail = await makeThumbnail(page.processedImage ?? file, 480);
          pages.push(page);
        }
        await persist({ ...doc, pages, searchableText: rebuildText(pages) });
      } finally {
        setSaving(false);
      }
    },
    [doc, persist, rebuildText],
  );

  const totalBytes = doc
    ? doc.pages.reduce(
        (sum, page) => sum + (page.originalImage?.size ?? 0) + (page.processedImage?.size ?? 0),
        0,
      )
    : 0;

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-zinc-400">
        <div className="mx-auto max-w-5xl">Loading document…</div>
      </main>
    );
  }

  if (notFound || !doc) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="text-2xl font-semibold">Document not found</h1>
          <p className="mt-3 text-zinc-500">It may have been deleted from this device.</p>
          <Link href="/library" className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-semibold text-zinc-950">
            Back to library
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
              {doc.pages.length} page{doc.pages.length === 1 ? "" : "s"} · {formatBytes(totalBytes)} ·
              updated {new Date(doc.updatedAt).toLocaleString()}
            </p>
            {editingTitle ? (
              <div className="mt-2 flex gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  autoFocus
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xl font-semibold outline-none focus:border-white"
                />
                <button onClick={() => void saveTitle()} className="rounded-lg bg-white px-4 text-sm font-semibold text-zinc-950">
                  Save
                </button>
              </div>
            ) : (
              <h1
                onClick={() => setEditingTitle(true)}
                className="mt-1 cursor-text truncate text-2xl font-semibold tracking-tight hover:text-zinc-300"
                title="Click to rename"
              >
                {doc.title}
              </h1>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/library" className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
              Library
            </Link>
            <button
              onClick={() => document.getElementById("add-pages-input")?.click()}
              disabled={saving}
              className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add pages"}
            </button>
            <button onClick={() => void deleteDocument()} className="rounded-lg border border-red-900/60 px-4 py-2 text-sm text-red-400 hover:bg-red-950/50">
              Delete document
            </button>
          </div>
          <input
            id="add-pages-input"
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addPagesViaFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </header>

        {!backendUp && (
          <p className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
            Processing engine offline — OCR, reprocessing and PDF export are unavailable until the
            C++ backend is running. Viewing, renaming, text editing and TXT/image export still work.
          </p>
        )}
        {notice && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="ml-4 text-zinc-500 hover:text-white">✕</button>
          </div>
        )}

        <section className="mt-6 space-y-6">
          {doc.pages.map((page, index) => {
            const previewBlob = view === "original" ? page.originalImage : (page.processedImage ?? page.originalImage);
            return (
              <article key={page.id} className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-300">Page {index + 1}</h2>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <button
                      onClick={() => void runOcr(index)}
                      disabled={busyPageIndex === index}
                      className="rounded-lg border border-zinc-800 px-3 py-1.5 text-zinc-200 hover:bg-zinc-900 disabled:opacity-40"
                    >
                      {busyPageIndex === index ? "Working…" : page.ocr ? "Re-run OCR" : "Run OCR"}
                    </button>
                    <button
                      onClick={() => void reprocessPage(index)}
                      disabled={busyPageIndex === index}
                      className="rounded-lg border border-zinc-800 px-3 py-1.5 text-zinc-200 hover:bg-zinc-900 disabled:opacity-40"
                    >
                      Re-process
                    </button>
                    <button
                      onClick={() => {
                        const blob = page.processedImage ?? page.originalImage;
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `${doc.title}-page-${index + 1}.jpg`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                      }}
                      className="rounded-lg border border-zinc-800 px-3 py-1.5 text-zinc-200 hover:bg-zinc-900"
                    >
                      Download image
                    </button>
                    <button onClick={() => void deletePage(index)} className="rounded-lg border border-red-900/60 px-3 py-1.5 text-red-400 hover:bg-red-950/50">
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex justify-center">
                  <div className="relative max-w-xl overflow-hidden rounded-xl border border-zinc-900 bg-zinc-900">
                    <BlobImage blob={previewBlob} className="block max-h-[70vh] w-auto" />
                    {page.ocr?.width && page.ocr.blocks.length > 0 && view === "processed" && (
                      <svg
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        viewBox={`0 0 ${page.ocr.width} ${page.ocr.height}`}
                        preserveAspectRatio="xMidYMid meet"
                      >
                        {page.ocr.blocks.flatMap((block) =>
                          block.lines.flatMap((line) =>
                            line.words.map((word) => (
                              <rect
                                key={word.id}
                                x={word.bbox.x}
                                y={word.bbox.y}
                                width={word.bbox.width}
                                height={word.bbox.height}
                                fill="rgba(34,197,94,0.10)"
                                stroke="rgba(34,197,94,0.55)"
                                strokeWidth="2"
                              />
                            )),
                          ),
                        )}
                      </svg>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    onClick={() => setView("processed")}
                    className={`rounded-lg px-3 py-1.5 text-xs ${view === "processed" ? "bg-white font-semibold text-zinc-950" : "border border-zinc-800 text-zinc-300 hover:bg-zinc-900"}`}
                  >
                    Processed
                  </button>
                  <button
                    onClick={() => setView("original")}
                    className={`rounded-lg px-3 py-1.5 text-xs ${view === "original" ? "bg-white font-semibold text-zinc-950" : "border border-zinc-800 text-zinc-300 hover:bg-zinc-900"}`}
                  >
                    Original
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-zinc-900 bg-zinc-900/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-zinc-300">
                      Extracted text
                      {page.ocr && (
                        <span className="ml-2 text-xs font-normal text-zinc-500">
                          confidence {page.ocr.confidence.toFixed(0)}%
                        </span>
                      )}
                    </h3>
                    {page.ocr && editingTextIndex !== index && (
                      <button
                        onClick={() => {
                          setEditingTextIndex(index);
                          setTextDraft(page.ocr!.text);
                        }}
                        className="text-xs text-zinc-400 hover:text-white"
                      >
                        Edit text
                      </button>
                    )}
                  </div>
                  {page.ocrError && <p className="mt-2 text-sm text-red-400">{page.ocrError}</p>}
                  {editingTextIndex === index ? (
                    <div className="mt-3">
                      <textarea
                        value={textDraft}
                        onChange={(e) => setTextDraft(e.target.value)}
                        rows={10}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-sm text-zinc-200 outline-none focus:border-white"
                      />
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => void saveEditedText()} className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-zinc-950">
                          Save text
                        </button>
                        <button onClick={() => setEditingTextIndex(null)} className="rounded-lg border border-zinc-800 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : page.ocr ? (
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-sm leading-6 text-zinc-300">
                      {page.ocr.text || "(no text recognized)"}
                    </pre>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-500">
                      No text layer yet — click &ldquo;Run OCR&rdquo; above to extract text.
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="mt-8 flex justify-center">
          <Link
            href={`/library?export=${doc.id}`}
            className="rounded-xl bg-white px-7 py-3 font-semibold text-zinc-950 shadow-lg shadow-white/5 hover:bg-zinc-200"
          >
            Export document…
          </Link>
        </section>
      </div>
    </main>
  );
}
