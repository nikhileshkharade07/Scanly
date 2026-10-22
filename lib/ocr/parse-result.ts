import type {
  BoundingBox,
  OCRBlock,
  OCRLine,
  OCRResult,
  OCRWord,
} from "@/types/scanner";

interface TesseractBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractWord {
  text?: string;
  confidence?: number;
  bbox?: TesseractBBox | null;
}

interface TesseractLine {
  text?: string;
  confidence?: number;
  bbox?: TesseractBBox | null;
  words?: TesseractWord[] | null;
}

interface TesseractBlock {
  block_type?: string;
  text?: string;
  confidence?: number;
  bbox?: TesseractBBox | null;
  lines?: TesseractLine[] | null;
}

interface TesseractRecognizeResult {
  text?: string;
  confidence?: number;
  blocks?: TesseractBlock[] | null;
}

function toBoundingBox(b?: TesseractBBox | null): BoundingBox {
  if (!b) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.max(0, Math.round(b.x0 ?? 0));
  const y = Math.max(0, Math.round(b.y0 ?? 0));
  const width = Math.max(0, Math.round((b.x1 ?? 0) - x));
  const height = Math.max(0, Math.round((b.y1 ?? 0) - y));
  return { x, y, width, height };
}

/**
 * Normalizes raw output from Tesseract.js into Scanly's typed OCRResult schema.
 * Accurately extracts word-level, line-level, and block-level bounding boxes and confidence.
 */
export function parseTesseractOutput(
  raw: TesseractRecognizeResult | null | undefined,
  imageWidth?: number,
  imageHeight?: number,
): OCRResult {
  if (!raw) {
    return {
      text: "",
      confidence: 0,
      width: imageWidth,
      height: imageHeight,
      blocks: [],
    };
  }

  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks: OCRBlock[] = [];

  rawBlocks.forEach((block, bIdx) => {
    const rawLines = Array.isArray(block.lines) ? block.lines : [];
    const lines: OCRLine[] = [];

    rawLines.forEach((line, lIdx) => {
      const rawWords = Array.isArray(line.words) ? line.words : [];
      const words: OCRWord[] = [];

      rawWords.forEach((word, wIdx) => {
        const text = (word.text ?? "").trim();
        if (text) {
          words.push({
            id: `b${bIdx}l${lIdx}w${wIdx}`,
            text,
            confidence: Math.round(word.confidence ?? 0),
            bbox: toBoundingBox(word.bbox),
          });
        }
      });

      const lineText = (line.text ?? "").trim();
      if (lineText || words.length > 0) {
        lines.push({
          id: `b${bIdx}l${lIdx}`,
          text: lineText || words.map((w) => w.text).join(" "),
          confidence: Math.round(line.confidence ?? 0),
          bbox: toBoundingBox(line.bbox),
          words,
        });
      }
    });

    const blockText = (block.text ?? "").trim();
    if (blockText || lines.length > 0) {
      blocks.push({
        id: `b${bIdx}`,
        type: block.block_type ?? "text",
        text: blockText || lines.map((l) => l.text).join("\n"),
        confidence: Math.round(block.confidence ?? 0),
        bbox: toBoundingBox(block.bbox),
        lines,
      });
    }
  });

  const fullText = (raw.text ?? "").trim();
  const confidence = Math.round(raw.confidence ?? 0);

  return {
    text: fullText,
    confidence,
    width: imageWidth,
    height: imageHeight,
    blocks,
  };
}
