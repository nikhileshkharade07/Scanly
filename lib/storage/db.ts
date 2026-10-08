import Dexie, { type EntityTable } from "dexie";
import type { DocumentRecord } from "@/types/scanner";
export class ScanlyDatabase extends Dexie {
  documents!: EntityTable<DocumentRecord, "id">;
  constructor() { super("scanly"); this.version(1).stores({ documents: "id, title, createdAt, updatedAt" }); }
}
export const db = new ScanlyDatabase();
