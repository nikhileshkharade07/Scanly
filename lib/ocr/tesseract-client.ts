import { createWorker, type Worker } from "tesseract.js";
import { parseTesseractOutput } from "./parse-result";
import type { OCRProgress } from "./types";
import type { OCRResult } from "@/types/scanner";

let cachedWorker: Worker | null = null;
let currentLanguage = "eng";

/** Normalize language parameter to standard Tesseract plus-delimited format (e.g. "eng+hin"). */
export function normalizeLanguageParam(lang?: string | string[]): string {
  if (!lang) return "eng";
  if (Array.isArray(lang)) {
    const cleaned = lang.map((l) => l.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned.join("+") : "eng";
  }
  const cleaned = lang
    .split("+")
    .map((l) => l.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned.join("+") : "eng";
}

/** Initialize or retrieve a reusable Tesseract worker. */
export async function getOrCreateWorker(
  lang: string | string[] = "eng",
  onProgress?: (progress: OCRProgress) => void,
): Promise<Worker> {
  const targetLang = normalizeLanguageParam(lang);

  if (cachedWorker && currentLanguage === targetLang) {
    return cachedWorker;
  }

  if (cachedWorker) {
    try {
      await cachedWorker.terminate();
    } catch {
      /* ignore */
    }
    cachedWorker = null;
  }

  try {
    onProgress?.({ status: `loading language (${targetLang})`, progress: 5 });

    const worker = await createWorker(targetLang, 1, {
      logger: (message) => {
        if (onProgress && typeof message === "object" && message !== null) {
          const statusStr = message.status ?? "processing";
          const progNum = typeof message.progress === "number" ? Math.round(message.progress * 100) : 0;
          onProgress({
            status: statusStr,
            progress: progNum,
          });
        }
      },
    });

    cachedWorker = worker;
    currentLanguage = targetLang;
    return worker;
  } catch (error) {
    cachedWorker = null;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to initialize OCR language (${targetLang}): ${msg}. If this is the first time using this language, an internet connection is required to download its trained data.`,
    );
  }
}

/**
 * Runs OCR directly in the browser via Tesseract.js Web Worker.
 * Supports single ("eng") or multiple combined languages ("eng+hin+mar").
 * Preserves page responsiveness and extracts structured text with word bounding boxes.
 */
export async function runClientOcr(
  imageBlob: Blob,
  lang: string | string[] = "eng",
  onProgress?: (progress: OCRProgress) => void,
): Promise<OCRResult> {
  // Determine pixel dimensions for coordinate mapping
  let width = 0;
  let height = 0;
  if (typeof window !== "undefined") {
    try {
      const bitmap = await createImageBitmap(imageBlob);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      /* fallback */
    }
  }

  const targetLang = normalizeLanguageParam(lang);
  onProgress?.({ status: `initializing engine (${targetLang})`, progress: 10 });
  const worker = await getOrCreateWorker(targetLang, onProgress);

  onProgress?.({ status: "recognizing text", progress: 25 });
  const result = await worker.recognize(imageBlob);

  onProgress?.({ status: "complete", progress: 100 });
  return parseTesseractOutput(result.data, width, height);
}

/** Explicitly terminates the cached worker when navigating away or unmounting. */
export async function terminateOcrWorker(): Promise<void> {
  if (cachedWorker) {
    try {
      await cachedWorker.terminate();
    } catch {
      /* ignore */
    }
    cachedWorker = null;
  }
}
