import { describe, expect, it } from "vitest";
import { generateDocumentTxt } from "@/lib/pdf/generate-pdf";
import type { DocumentRecord } from "@/types/scanner";

describe("document export helpers", () => {
  it("formats multi-page text cleanly in TXT export", async () => {
    const dummyBlob = new Blob(["dummy"], { type: "image/jpeg" });
    const doc: DocumentRecord = {
      id: "doc-1",
      title: "Quarterly Report",
      status: "saved",
      searchableText: "Page 1 content\nPage 2 content",
      createdAt: 1000,
      updatedAt: 2000,
      pages: [
        {
          id: "p1",
          originalImage: dummyBlob,
          filter: "original",
          ocr: {
            text: "Revenue grew 25%",
            confidence: 95,
            blocks: [],
          },
          createdAt: 1000,
        },
        {
          id: "p2",
          originalImage: dummyBlob,
          filter: "original",
          ocr: {
            text: "Net margins: 18%",
            confidence: 90,
            blocks: [],
          },
          createdAt: 1000,
        },
      ],
    };

    const txtBlob = generateDocumentTxt(doc);
    expect(txtBlob.type).toBe("text/plain;charset=utf-8");

    const content = await txtBlob.text();
    expect(content).toContain("Scanly Document: Quarterly Report");
    expect(content).toContain("Page 1 of 2");
    expect(content).toContain("Revenue grew 25%");
    expect(content).toContain("Page 2 of 2");
    expect(content).toContain("Net margins: 18%");
  });
});
