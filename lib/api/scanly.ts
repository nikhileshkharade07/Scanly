import type { DocumentRecord, FilterId, OCRResult, Rotation } from "@/types/scanner";
import { detectDocument, processDocument } from "@/lib/vision/processor";
import { runClientOcr } from "@/lib/ocr/tesseract-client";
import { generateSearchablePdf } from "@/lib/pdf/generate-pdf";
import type { OCRProgress } from "@/lib/ocr/types";

/** Base URL of the local C++ processing backend. Loopback only — documents never leave the device. */
export const SCANLY_API_BASE = (process.env.NEXT_PUBLIC_SCANLY_API ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

export class ScanlyApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ScanlyApiError";
    this.status = status;
    this.code = code;
  }
}

export type HealthInfo = {
  status: string;
  version: string;
  engine: { opencv: string; tesseract: string };
  languages: string[];
};

export type ProcessOptions = {
  /** Normalized [0..1] corners (TL, TR, BR, BL) for perspective correction; omit for no crop/warp. */
  corners?: [number, number][];
  filter: FilterId;
  rotation?: Rotation;
  /** 1 = unchanged, range 0.5–2.0. */
  brightness?: number;
  /** 1 = unchanged, range 0.5–2.0. */
  contrast?: number;
  /** Optional output width cap in pixels. */
  maxWidth?: number;
};

export type PdfPageMeta = { ocr?: OCRResult | null };
export type PdfMeta = { title: string; pages: PdfPageMeta[] };

const TIMEOUTS_MS = { health: 1500, detect: 5000, process: 8000, ocr: 10000, pdf: 10000 } as const;

let backendReachable = false;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function raiseAsApiError(response: Response): Promise<never> {
  let code = "http_error";
  let message = `Request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.code) code = body.error.code;
  } catch {
    /* non-JSON error body */
  }
  throw new ScanlyApiError(response.status, code, message);
}

function imageForm(image: Blob, extra?: Record<string, string>): FormData {
  const form = new FormData();
  form.append("image", image, "capture.png");
  if (extra) for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

async function postJson<T>(path: string, form: FormData, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(`${SCANLY_API_BASE}${path}`, { method: "POST", body: form }, timeoutMs);
  if (!response.ok) await raiseAsApiError(response);
  return (await response.json()) as T;
}

export const scanlyApi = {
  /** Backend liveness + engine info. Never throws; returns browser engine when backend is offline. */
  async ping(): Promise<HealthInfo> {
    try {
      const response = await fetchWithTimeout(`${SCANLY_API_BASE}/api/health`, { method: "GET" }, TIMEOUTS_MS.health);
      if (response.ok) {
        backendReachable = true;
        return (await response.json()) as HealthInfo;
      }
    } catch {
      /* offline */
    }
    backendReachable = false;
    return {
      status: "browser-ready",
      version: "1.0.0-wasm",
      engine: { opencv: "Browser Canvas + Vision", tesseract: "Tesseract.js Web Worker" },
      languages: ["eng"],
    };
  },

  async languages(): Promise<string[]> {
    if (backendReachable) {
      try {
        const info = await postJson<{ languages: string[] }>(
          "/api/ocr/languages",
          new FormData(),
          TIMEOUTS_MS.health,
        );
        if (info?.languages?.length) return info.languages;
      } catch {
        /* fallback to browser languages */
      }
    }
    return ["eng"];
  },

  /** Document boundary detection on a still image or camera frame. */
  async detect(image: Blob): Promise<import("@/types/scanner").DetectResult> {
    if (backendReachable) {
      try {
        return await postJson("/api/vision/detect", imageForm(image), TIMEOUTS_MS.detect);
      } catch (err) {
        console.warn("Backend detection failed, using browser detector:", err);
      }
    }
    return detectDocument(image);
  },

  /** Perspective correction + enhancement. Returns processed image bytes (JPEG). */
  async process(image: Blob, options: ProcessOptions): Promise<Blob> {
    if (backendReachable) {
      try {
        const form = imageForm(image, { options: JSON.stringify(options) });
        const response = await fetchWithTimeout(`${SCANLY_API_BASE}/api/image/process`, { method: "POST", body: form }, TIMEOUTS_MS.process);
        if (response.ok) return response.blob();
      } catch (err) {
        console.warn("Backend process failed, using browser processor:", err);
      }
    }
    return processDocument(image, options);
  },

  /** Real OCR with word-level boxes and confidence. */
  async ocr(
    image: Blob,
    lang = "eng",
    onProgress?: (progress: OCRProgress) => void,
  ): Promise<OCRResult> {
    if (backendReachable) {
      try {
        const result = await postJson<OCRResult>("/api/ocr", imageForm(image, { lang }), TIMEOUTS_MS.ocr);
        if (typeof result?.text === "string" && Array.isArray(result.blocks)) {
          return result;
        }
      } catch (err) {
        console.warn("Backend OCR failed, using browser Tesseract.js:", err);
      }
    }
    return runClientOcr(image, lang, onProgress);
  },

  /** Multi-page searchable PDF: scanned page images + invisible OCR text layer positioned by word boxes. */
  async searchablePdf(
    meta: PdfMeta,
    pages: Blob[],
    docRecord?: DocumentRecord,
    onProgress?: (curr: number, total: number) => void,
  ): Promise<Blob> {
    if (backendReachable) {
      try {
        const form = new FormData();
        form.append("meta", JSON.stringify(meta));
        pages.forEach((page, index) => form.append(`page_${index}`, page, `page_${index}.jpg`));
        const response = await fetchWithTimeout(`${SCANLY_API_BASE}/api/pdf/searchable`, { method: "POST", body: form }, TIMEOUTS_MS.pdf);
        if (response.ok) return response.blob();
      } catch (err) {
        console.warn("Backend PDF generation failed, using browser jsPDF:", err);
      }
    }

    if (docRecord) {
      return generateSearchablePdf(docRecord, onProgress);
    }

    // Synthesize DocumentRecord from meta and pages
    const synthDoc: DocumentRecord = {
      id: crypto.randomUUID(),
      title: meta.title,
      status: "saved",
      searchableText: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pages: pages.map((blob, idx) => ({
        id: `p_${idx}`,
        originalImage: blob,
        processedImage: blob,
        filter: "original",
        ocr: meta.pages[idx]?.ocr ?? undefined,
        createdAt: Date.now(),
      })),
    };
    return generateSearchablePdf(synthDoc, onProgress);
  },
};
