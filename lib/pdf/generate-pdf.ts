import { jsPDF } from "jspdf";
import type { DocumentRecord, ScanPage } from "@/types/scanner";

/** Convert a Blob to a base64 Data URL for jsPDF. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read blob as Data URL"));
    reader.readAsDataURL(blob);
  });
}

export type PdfProgressCallback = (current: number, total: number) => void;

/**
 * Client-side Searchable PDF Generator:
 * 1. Embeds each scanned page image at optimal resolution.
 * 2. Injects an invisible, selectable OCR text layer (PDF text rendering mode 3: "Neither fill nor stroke")
 *    precisely aligned with word bounding boxes.
 * 3. Works 100% locally in the browser with zero cloud dependencies.
 */
export async function generateSearchablePdf(
  doc: DocumentRecord,
  onProgress?: PdfProgressCallback,
): Promise<Blob> {
  if (!doc.pages || doc.pages.length === 0) {
    throw new Error("Cannot generate PDF from empty document");
  }

  const pdf = new jsPDF({
    unit: "pt",
    compress: true,
  });

  const totalPages = doc.pages.length;

  for (let i = 0; i < totalPages; i++) {
    onProgress?.(i + 1, totalPages);
    const page = doc.pages[i];
    const imageBlob = page.processedImage ?? page.originalImage;
    const dataUrl = await blobToDataUrl(imageBlob);

    // Determine dimensions
    let imgW = page.ocr?.width;
    let imgH = page.ocr?.height;

    if (!imgW || !imgH) {
      if (typeof window !== "undefined") {
        try {
          const bmp = await createImageBitmap(imageBlob);
          imgW = bmp.width;
          imgH = bmp.height;
          bmp.close();
        } catch {
          imgW = 800;
          imgH = 1100;
        }
      } else {
        imgW = 800;
        imgH = 1100;
      }
    }

    // Convert pixels to PDF points (assume 72 pt/in, scaled to fit standard page dimensions)
    const scale = 595.28 / Math.max(1, imgW); // A4 width in pt = 595.28
    const pageW = Math.round(imgW * scale);
    const pageH = Math.round(imgH * scale);

    if (i === 0) {
      pdf.deletePage(1); // Remove default blank page
    }

    pdf.addPage([pageW, pageH], pageW > pageH ? "landscape" : "portrait");

    // 1. Draw page image filling the PDF page
    pdf.addImage(dataUrl, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");

    // 2. Add invisible OCR text layer if words are present
    if (page.ocr && page.ocr.blocks && page.ocr.blocks.length > 0) {
      const scaleX = pageW / imgW;
      const scaleY = pageH / imgH;

      for (const block of page.ocr.blocks) {
        for (const line of block.lines) {
          if (line.words && line.words.length > 0) {
            for (const word of line.words) {
              if (!word.text) continue;
              const wx = word.bbox.x * scaleX;
              // Baseline is at the bottom of the bounding box
              const wy = (word.bbox.y + word.bbox.height) * scaleY;
              const fontSizePt = Math.max(4, Math.min(72, word.bbox.height * scaleY * 0.85));

              pdf.setFontSize(fontSizePt);
              try {
                // Sanitize string to standard characters safe for standard PDF fonts
                const safeText = word.text.replace(/[\u0000-\u001F]/g, "");
                pdf.text(safeText, wx, wy, { renderingMode: "invisible" });
              } catch {
                /* skip problematic glyph */
              }
            }
          } else if (line.text) {
            const lx = line.bbox.x * scaleX;
            const ly = (line.bbox.y + line.bbox.height) * scaleY;
            const fontSizePt = Math.max(4, Math.min(72, line.bbox.height * scaleY * 0.85));
            pdf.setFontSize(fontSizePt);
            try {
              pdf.text(line.text.replace(/[\u0000-\u001F]/g, ""), lx, ly, { renderingMode: "invisible" });
            } catch {
              /* skip */
            }
          }
        }
      }
    }
  }

  return pdf.output("blob");
}

/**
 * Plain Text (TXT) export with clear per-page headings.
 */
export function generateDocumentTxt(doc: DocumentRecord): Blob {
  const text = doc.pages
    .map((page, index) => {
      const pageHeader = `========================================================\nPage ${index + 1} of ${doc.pages.length}\n========================================================`;
      const pageContent = page.ocr?.text ? page.ocr.text.trim() : "(No text recognized on this page)";
      return `${pageHeader}\n\n${pageContent}`;
    })
    .join("\n\n\n");

  const fullContent = `Scanly Document: ${doc.title}\nExported: ${new Date().toLocaleString()}\nTotal Pages: ${doc.pages.length}\n\n${text}`;
  return new Blob([fullContent], { type: "text/plain;charset=utf-8" });
}
