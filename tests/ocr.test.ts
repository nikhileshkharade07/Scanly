import { describe, expect, it } from "vitest";
import { parseTesseractOutput } from "@/lib/ocr/parse-result";
import { normalizeLanguageParam } from "@/lib/ocr/tesseract-client";

describe("OCR parsing", () => {
  it("handles null and empty input gracefully", () => {
    const res = parseTesseractOutput(null, 800, 600);
    expect(res.text).toBe("");
    expect(res.confidence).toBe(0);
    expect(res.width).toBe(800);
    expect(res.height).toBe(600);
    expect(res.blocks).toEqual([]);
  });

  it("extracts blocks, lines, words, and converts bounding boxes", () => {
    const raw = {
      text: "Invoice #1024\nTotal: $500",
      confidence: 94.6,
      blocks: [
        {
          block_type: "text",
          text: "Invoice #1024",
          confidence: 96.2,
          bbox: { x0: 10, y0: 20, x1: 200, y1: 50 },
          lines: [
            {
              text: "Invoice #1024",
              confidence: 96.2,
              bbox: { x0: 10, y0: 20, x1: 200, y1: 50 },
              words: [
                {
                  text: "Invoice",
                  confidence: 98.0,
                  bbox: { x0: 10, y0: 20, x1: 90, y1: 50 },
                },
                {
                  text: "#1024",
                  confidence: 94.4,
                  bbox: { x0: 100, y0: 20, x1: 200, y1: 50 },
                },
              ],
            },
          ],
        },
      ],
    };

    const res = parseTesseractOutput(raw, 1000, 1500);
    expect(res.text).toBe("Invoice #1024\nTotal: $500");
    expect(res.confidence).toBe(95);
    expect(res.width).toBe(1000);
    expect(res.height).toBe(1500);
    expect(res.blocks).toHaveLength(1);

    const block = res.blocks[0];
    expect(block.bbox).toEqual({ x: 10, y: 20, width: 190, height: 30 });
    expect(block.lines).toHaveLength(1);

    const line = block.lines[0];
    expect(line.words).toHaveLength(2);

    const word0 = line.words[0];
    expect(word0.text).toBe("Invoice");
    expect(word0.confidence).toBe(98);
    expect(word0.bbox).toEqual({ x: 10, y: 20, width: 80, height: 30 });

    const word1 = line.words[1];
    expect(word1.text).toBe("#1024");
    expect(word1.confidence).toBe(94);
    expect(word1.bbox).toEqual({ x: 100, y: 20, width: 100, height: 30 });
  });
});

describe("OCR Multilingual parameter normalization", () => {
  it("defaults undefined or empty strings to 'eng'", () => {
    expect(normalizeLanguageParam()).toBe("eng");
    expect(normalizeLanguageParam("")).toBe("eng");
    expect(normalizeLanguageParam([])).toBe("eng");
  });

  it("normalizes arrays of language codes into plus-delimited strings", () => {
    expect(normalizeLanguageParam(["eng", "hin"])).toBe("eng+hin");
    expect(normalizeLanguageParam(["eng", "hin", "mar"])).toBe("eng+hin+mar");
  });

  it("handles whitespace and pre-formatted plus strings correctly", () => {
    expect(normalizeLanguageParam("eng + hin + mar ")).toBe("eng+hin+mar");
    expect(normalizeLanguageParam([" eng ", " hin "])).toBe("eng+hin");
  });
});

