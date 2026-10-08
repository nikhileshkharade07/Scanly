import { db } from "./db";
import type { DocumentRecord } from "@/types/scanner";
export async function createDocument(document: DocumentRecord) { return db.documents.add(document); }
export async function getDocument(id: string) { return db.documents.get(id); }
export async function listDocuments() { return db.documents.orderBy("updatedAt").reverse().toArray(); }
export async function updateDocument(id: string, changes: Partial<DocumentRecord>) { return db.documents.update(id, { ...changes, updatedAt: Date.now() }); }
export async function deleteDocument(id: string) { return db.documents.delete(id); }
export async function searchDocuments(query: string) { const normalized = query.trim().toLocaleLowerCase(); if (!normalized) return listDocuments(); return (await listDocuments()).filter((doc) => `${doc.title} ${doc.searchableText}`.toLocaleLowerCase().includes(normalized)); }
