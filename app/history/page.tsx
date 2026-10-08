"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { db } from "@/lib/storage/db";
import type { DocumentRecord, ScanPage } from "@/types/scanner";

export default function HistoryPage() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState<{ [id: string]: boolean }>({});
  const [isDeleting, setIsDeleting] = useState<{ [id: string]: boolean }>({});
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load documents from Dexie
  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const docs = await db.documents.toArray();
      // Sort by updatedAt descending (newest first)
      const sortedDocs = docs.sort((a, b) => b.updatedAt - a.updatedAt);
      setDocuments(sortedDocs);
    } catch (err) {
      setError("Failed to load scan history");
      console.error("Database error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Search documents
  const performSearch = useCallback(async (term: string) => {
    try {
      setLoading(true);
      setError(null);

      if (!term.trim()) {
        const docs = await db.documents.toArray();
        const sortedDocs = docs.sort((a, b) => b.updatedAt - a.updatedAt);
        setDocuments(sortedDocs);
        return;
      }

      // Search in title and searchableText
      const docs = await db.documents
        .filter((doc) =>
          doc.title.toLowerCase().includes(term.toLowerCase()) ||
          doc.searchableText.toLowerCase().includes(term.toLowerCase())
        )
        .toArray();

      const sortedDocs = docs.sort((a, b) => b.updatedAt - a.updatedAt);
      setDocuments(sortedDocs);
    } catch (err) {
      setError("Failed to search scan history");
      console.error("Database search error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle search input with debounce
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setSearchTerm(term);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      performSearch(term);
    }, 300);
  }, [performSearch]);

  // Rename document
  const handleRename = useCallback(async (docId: string, newTitle: string) => {
    if (!newTitle.trim()) {
      setError("Title cannot be empty");
      return;
    }

    try {
      setIsRenaming(prev => ({ ...prev, [docId]: true }));
      await db.documents.update(docId, {
        title: newTitle.trim(),
        updatedAt: Date.now()
      });

      // Update local state
      setDocuments(prev =>
        prev.map(doc =>
          doc.id === docId
            ? { ...doc, title: newTitle.trim(), updatedAt: Date.now() }
            : doc
        )
      );

      setIsRenaming(prev => ({ ...prev, [docId]: false }));
    } catch (err) {
      setError("Failed to rename scan");
      console.error("Rename error:", err);
      setIsRenaming(prev => ({ ...prev, [docId]: false }));
    }
  }, []);

  // Delete document
  const handleDelete = useCallback(async (docId: string) => {
    try {
      setIsDeleting(prev => ({ ...prev, [docId]: true }));
      await db.documents.delete(docId);

      // Update local state
      setDocuments(prev => prev.filter(doc => doc.id !== docId));

      setIsDeleting(prev => ({ ...prev, [docId]: false }));
    } catch (err) {
      setError("Failed to delete scan");
      console.error("Delete error:", err);
      setIsDeleting(prev => ({ ...prev, [docId]: false }));
    }
  }, []);

  // Delete all documents
  const handleDeleteAll = useCallback(async () => {
    if (!deleteAllConfirm) return;

    try {
      setDeleteAllConfirm(true);
      await db.documents.clear();
      setDocuments([]);
    } catch (err) {
      setError("Failed to clear history");
      console.error("Clear all error:", err);
    } finally {
      setDeleteAllConfirm(false);
    }
  }, [deleteAllConfirm]);

  // Open document (navigate to scan page with docId)
  const handleOpenDoc = useCallback((docId: string) => {
    setSelectedDocId(docId);
    // In a real app, we'd navigate to a scan view page
    // For now, we'll just select it and show it in a modal or similar
    // Since we're extending the existing scan page, we'll need to modify it to accept a docId
    // For simplicity in this implementation, we'll just set state and let the UI handle it
  }, []);

  // Auto-save edited text (debounced)
  const [editedText, setEditedText] = useState("");
  const [editDocId, setEditDocId] = useState<string | null>(null);
  const editDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleTextChange = useCallback((text: string, docId: string) => {
    setEditedText(text);
    setEditDocId(docId);

    if (editDebounceRef.current) {
      clearTimeout(editDebounceRef.current);
    }

    editDebounceRef.current = setTimeout(() => {
      if (editDocId && editedText !== "") {
        db.documents.update(editDocId, {
          searchableText: editedText,
          updatedAt: Date.now()
        }).then(() => {
          // Update local state
          setDocuments(prev =>
            prev.map(doc =>
              doc.id === editDocId
                ? { ...doc, searchableText: editedText, updatedAt: Date.now() }
                : doc
            )
          );
        }).catch(err => {
          console.error("Autosave error:", err);
        });
      }
    }, 1000);
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  if (loading && documents.length === 0) {
    return (
      <main className="min-h-screen bg-zinc-950 p-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="mb-6 text-3xl font-semibold text-zinc-50">Scan History</h1>
          <div className="flex items-center justify-center h-64">
            <div className="text-center text-zinc-500">
              <p className="mb-4">Loading your scan history...</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error && documents.length === 0) {
    return (
      <main className="min-h-screen bg-zinc-950 p-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="mb-6 text-3xl font-semibold text-zinc-50">Scan History</h1>
          <div className="bg-zinc-900 rounded-lg p-6">
            <p className="text-red-400 font-medium">{error}</p>
            <button
              onClick={() => {
                setError(null);
                loadDocuments();
              }}
              className="mt-4 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Try Again
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-semibold text-zinc-50">Scan History</h1>
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Search scans..."
                value={searchTerm}
                onChange={handleSearchChange}
                className="flex-1 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-100 focus:ring-2 focus:ring-zinc-600"
              />
              <button
                onClick={() => setDeleteAllConfirm(!deleteAllConfirm)}
                className={`rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium transition ${
                  deleteAllConfirm
                    ? "bg-red-600 text-white"
                    : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                }`}
              >
                {deleteAllConfirm ? "Cancel" : "Clear History"}
              </button>
            </div>
          </div>

          {deleteAllConfirm && (
            <div className="bg-zinc-900 rounded-lg p-4">
              <p className="text-zinc-400">Delete all saved scans? This cannot be undone.</p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setDeleteAllConfirm(false)}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAll}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Delete All
                </button>
              </div>
            </div>
          )}

          {documents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-zinc-500 mb-4">No scans yet</p>
              <p className="text-zinc-400">Scan a document and your saved scans will appear here.</p>
              <a
                href="/scan"
                className="inline-block mt-6 rounded-lg bg-white px-6 py-3 font-semibold text-zinc-950 shadow-lg shadow-white/5 transition hover:bg-zinc-200"
              >
                Start Scanning
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className="border border-zinc-800 bg-zinc-900 rounded-lg overflow-hidden hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <h3 className="font-medium text-zinc-50 truncate" title={doc.title}>
                          {doc.title}
                        </h3>
                        <p className="text-xs text-zinc-400">
                          {new Date(doc.updatedAt).toLocaleDateString()} {new Date(doc.updatedAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        {!isRenaming[doc.id] && !isDeleting[doc.id] && (
                          <>
                            <button
                              onClick={() => {
                                // In a full implementation, this would navigate to scan page with docId
                                // For now, we'll just show an alert or modify the scan page to handle docId
                                alert(`Opening scan: ${doc.title}`);
                              }}
                              className="text-zinc-400 hover:text-zinc-100"
                            >
                              📄
                            </button>
                            <button
                              onClick={() => setIsRenaming(prev => ({ ...prev, [doc.id]: true }))}
                              className="text-zinc-400 hover:text-zinc-100"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => setIsDeleting(prev => ({ ...prev, [doc.id]: true }))}
                              className="text-zinc-400 hover:text-zinc-100"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isRenaming[doc.id] && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={doc.title}
                          onChange={(e) => {
                            const newTitle = e.target.value;
                            if (newTitle.trim() && newTitle !== doc.title) {
                              handleRename(doc.id, newTitle);
                            }
                          }}
                          onBlur={() => setIsRenaming(prev => ({ ...prev, [doc.id]: false }))}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-100 focus:ring-2 focus:ring-zinc-600"
                        />
                      </div>
                    )}

                    {isDeleting[doc.id] && (
                      <div className="mt-2">
                        <p className="text-zinc-400 text-sm">Delete this scan?</p>
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            onClick={() => setIsDeleting(prev => ({ ...prev, [doc.id]: false }))}
                            className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-100 hover:bg-zinc-900"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleDelete(doc.id)}
                            className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}

                    {!isRenaming[doc.id] && !isDeleting[doc.id] && doc.searchableText && (
                      <div className="mt-3">
                        <p className="text-xs text-zinc-400 line-clamp-2 max-w-full">
                          {'"' + doc.searchableText.substring(0, 100) + (doc.searchableText.length > 100 ? "..." : "") + '"'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}