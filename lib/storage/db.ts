import Dexie, { type EntityTable } from "dexie";
import type { DocumentRecord, ScanPage } from "@/types/scanner";

type LegacyDocument = Partial<DocumentRecord> & { id: string; pages?: Partial<ScanPage>[] };

/**
 * Documents are stored entirely on-device (IndexedDB).
 * v2 adds `status` (draft/saved) and per-page `rotation` defaults for records
 * created before the C++ backend migration.
 */
export class ScanlyDatabase extends Dexie {
  documents!: EntityTable<DocumentRecord, "id">;

  constructor() {
    super("scanly");
    this.version(2)
      .stores({
        documents: "id, title, status, createdAt, updatedAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table("documents")
          .toCollection()
          .modify((record) => {
            const doc = record as LegacyDocument;
            doc.status = doc.status === "draft" ? "draft" : "saved";
            doc.searchableText = doc.searchableText ?? "";
            for (const page of doc.pages ?? []) {
              page.rotation = page.rotation ?? 0;
              page.filter = page.filter ?? "original";
            }
          });
      });
  }
}

export const db = new ScanlyDatabase();
