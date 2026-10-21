import { db } from "./db";
import { includesSearchText, normalizeSearchText } from "@/lib/search/text-search";
import type { DocumentRecord, DocumentStatus, ScanPage } from "@/types/scanner";

/** Keep the denormalized search field in sync with per-page OCR text. */
export function withRecomputedSearchText(doc: DocumentRecord): DocumentRecord {
  return { ...doc, searchableText: doc.pages.map((page) => page.ocr?.text ?? "").join("\n").trim() };
}

export async function createDocument(document: DocumentRecord) {
  return db.documents.add(document);
}

export async function getDocument(id: string) {
  return db.documents.get(id);
}

export async function listDocuments() {
  return db.documents.orderBy("updatedAt").reverse().toArray();
}

export async function updateDocument(id: string, changes: Partial<DocumentRecord>) {
  return db.documents.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteDocument(id: string) {
  return db.documents.delete(id);
}

/** Case-insensitive substring search over title + derived OCR text. Empty query lists everything. */
export async function searchDocuments(query: string): Promise<DocumentRecord[]> {
  const normalized = normalizeSearchText(query);
  const all = await listDocuments();
  if (!normalized) return all;
  return all.filter(
    (doc) =>
      includesSearchText(doc.title, normalized) || includesSearchText(doc.searchableText, normalized),
  );
}

export async function listDocumentsByStatus(status: DocumentStatus) {
  const all = await listDocuments();
  return all.filter((doc) => (doc.status ?? "saved") === status);
}

export async function setDocumentStatus(id: string, status: DocumentStatus) {
  return updateDocument(id, { status });
}

/** Append a page, refresh derived fields, keep the record readable by old and new code. */
export async function appendPage(id: string, page: ScanPage): Promise<DocumentRecord | undefined> {
  const doc = await getDocument(id);
  if (!doc) return undefined;
  const next = withRecomputedSearchText({ ...doc, pages: [...doc.pages, page], updatedAt: Date.now() });
  await db.documents.put(next);
  return next;
}

export async function updatePage(id: string, pageId: string, changes: Partial<ScanPage>): Promise<DocumentRecord | undefined> {
  const doc = await getDocument(id);
  if (!doc) return undefined;
  const pages = doc.pages.map((page) => (page.id === pageId ? { ...page, ...changes } : page));
  const next = withRecomputedSearchText({ ...doc, pages, updatedAt: Date.now() });
  await db.documents.put(next);
  return next;
}

export async function removePage(id: string, pageId: string): Promise<DocumentRecord | undefined> {
  const doc = await getDocument(id);
  if (!doc) return undefined;
  const pages = doc.pages.filter((page) => page.id !== pageId);
  const next = withRecomputedSearchText({ ...doc, pages, updatedAt: Date.now() });
  await db.documents.put(next);
  return next;
}

/** Reorder pages to match the given id order; unknown ids are ignored, missing ids stay in place. */
export async function reorderPages(id: string, orderedIds: string[]): Promise<DocumentRecord | undefined> {
  const doc = await getDocument(id);
  if (!doc) return undefined;
  const byId = new Map(doc.pages.map((page) => [page.id, page]));
  const reordered = orderedIds.map((pageId) => byId.get(pageId)).filter((page): page is ScanPage => Boolean(page));
  for (const page of doc.pages) if (!orderedIds.includes(page.id)) reordered.push(page);
  const next = { ...doc, pages: reordered, updatedAt: Date.now() };
  await db.documents.put(next);
  return next;
}

/** Persist a full document (used for draft autosave from the scanner). */
export async function putDocument(doc: DocumentRecord): Promise<void> {
  await db.documents.put(doc);
}

export async function clearAllDocuments(): Promise<void> {
  await db.documents.clear();
}

export type StorageEstimate = { usage: number | null; quota: number | null };

/** Real numbers from the browser storage API; nulls when unavailable. */
export async function estimateStorage(): Promise<StorageEstimate> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage: usage ?? null, quota: quota ?? null };
    }
  } catch (error) {
    console.error("Storage estimate failed:", error);
  }
  return { usage: null, quota: null };
}

export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "QuotaExceededError" || /quota/i.test(error.message);
}
