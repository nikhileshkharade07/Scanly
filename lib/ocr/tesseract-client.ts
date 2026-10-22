import { createWorker, type Worker } from "tesseract.js";
import { parseTesseractOutput } from "./parse-result";
import type { OCRProgress } from "./types";
import type { OCRResult } from "@/types/scanner";

let cachedWorker: Worker | null = null;
let currentLanguage = "eng";

/** Initialize or retrieve a reusable Tesseract worker. */
async function getOrCreateWorker(
  lang = "eng",
  onProgress?: (progress: OCRProgress) => void,
): Promise<Worker> {
  if (cachedWorker && currentLanguage === lang) {
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

  const worker = await createWorker(lang, 1, {
    logger: (message) => {
      if (onProgress && typeof message === "object" && message !== null) {
        onProgress({
          status: message.status ?? "processing",
          progress: typeof message.progress === "number" ? Math.round(message.progress * 100) : 0,
        });
      }
    },
  });

  cachedWorker = worker;
  currentLanguage = lang;
  return worker;
}

/**
 * Runs OCR directly in the browser via Tesseract.js Web Worker.
 * Preserves page responsiveness and extracts structured text with word bounding boxes.
 */
export async function runClientOcr(
  imageBlob: Blob,
  lang = "eng",
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

  onProgress?.({ status: "initializing engine", progress: 5 });
  const worker = await getOrCreateWorker(lang, onProgress);

  onProgress?.({ status: "recognizing text", progress: 20 });
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
