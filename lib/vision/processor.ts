import {
  calculateOutputDimensions,
  getProjectiveTransform,
  invert3x3,
  orderCorners,
} from "./geometry";
import { applyBrightnessContrast, applyFilter } from "./filters";
import { detectDocumentCorners } from "./detector";
import type { DetectResult, Point } from "@/types/scanner";
import type { ProcessOptions } from "@/lib/api/scanly";

/** Helper to load a Blob into an HTMLImageElement in the browser. */
export function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image blob"));
    };
    img.src = url;
  });
}

/**
 * Client-side automatic document corner detection.
 * Operates purely in-browser on an HTMLCanvas.
 */
export async function detectDocument(blob: Blob): Promise<DetectResult> {
  if (typeof window === "undefined") {
    return { found: false, confidence: 0, corners: [], imageWidth: 0, imageHeight: 0 };
  }

  const img = await loadImageElement(blob);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  // Downscale to max 480px for sub-50ms edge detection
  const maxDim = 480;
  const scale = Math.min(1, maxDim / Math.max(origW, origH));
  const workW = Math.max(1, Math.round(origW * scale));
  const workH = Math.max(1, Math.round(origH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = workW;
  canvas.height = workH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { found: false, confidence: 0, corners: [], imageWidth: origW, imageHeight: origH };
  }

  ctx.drawImage(img, 0, 0, workW, workH);
  const imgData = ctx.getImageData(0, 0, workW, workH);
  const gray = new Uint8Array(workW * workH);

  for (let i = 0, j = 0; i < imgData.data.length; i += 4, j++) {
    gray[j] = Math.round(
      0.299 * imgData.data[i] + 0.587 * imgData.data[i + 1] + 0.114 * imgData.data[i + 2],
    );
  }

  const result = detectDocumentCorners(gray, workW, workH);
  return {
    ...result,
    imageWidth: origW,
    imageHeight: origH,
  };
}

/**
 * Client-side document perspective warp, rotation, enhancement filter, and export.
 * Returns processed JPEG Blob.
 */
export async function processDocument(
  blob: Blob,
  options: ProcessOptions,
): Promise<Blob> {
  const img = await loadImageElement(blob);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  // Step 1: Perspective Warp (or direct copy if no corners provided)
  let workingCanvas = document.createElement("canvas");
  let workingCtx = workingCanvas.getContext("2d");
  if (!workingCtx) throw new Error("Could not create 2D canvas context");

  if (options.corners && options.corners.length === 4) {
    // Map normalized [0..1] corners to image pixels
    const pixelCorners: [Point, Point, Point, Point] = [
      { x: options.corners[0][0] * origW, y: options.corners[0][1] * origH },
      { x: options.corners[1][0] * origW, y: options.corners[1][1] * origH },
      { x: options.corners[2][0] * origW, y: options.corners[2][1] * origH },
      { x: options.corners[3][0] * origW, y: options.corners[3][1] * origH },
    ];
    const ordered = orderCorners(pixelCorners);
    const { width: outW, height: outH } = calculateOutputDimensions(ordered, options.maxWidth ?? 2000);

    workingCanvas.width = outW;
    workingCanvas.height = outH;

    // Destination rect points
    const dstCorners: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ];

    // Source image canvas
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = origW;
    srcCanvas.height = origH;
    const srcCtx = srcCanvas.getContext("2d");
    if (!srcCtx) throw new Error("Could not get source canvas context");
    srcCtx.drawImage(img, 0, 0);

    const srcData = srcCtx.getImageData(0, 0, origW, origH);
    const dstData = workingCtx.createImageData(outW, outH);

    // Compute projective matrix mapping dst -> src for backward inverse sampling (no holes)
    const H = getProjectiveTransform(dstCorners, ordered);

    const sData = srcData.data;
    const dData = dstData.data;

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const denom = H[6] * x + H[7] * y + H[8];
        const sx = (H[0] * x + H[1] * y + H[2]) / denom;
        const sy = (H[3] * x + H[4] * y + H[5]) / denom;

        const isx = Math.round(sx);
        const isy = Math.round(sy);

        const dstIdx = (y * outW + x) * 4;
        if (isx >= 0 && isx < origW && isy >= 0 && isy < origH) {
          const srcIdx = (isy * origW + isx) * 4;
          dData[dstIdx] = sData[srcIdx];
          dData[dstIdx + 1] = sData[srcIdx + 1];
          dData[dstIdx + 2] = sData[srcIdx + 2];
          dData[dstIdx + 3] = 255;
        } else {
          dData[dstIdx] = 255;
          dData[dstIdx + 1] = 255;
          dData[dstIdx + 2] = 255;
          dData[dstIdx + 3] = 255;
        }
      }
    }
    workingCtx.putImageData(dstData, 0, 0);
  } else {
    // No warp specified: draw original directly
    workingCanvas.width = origW;
    workingCanvas.height = origH;
    workingCtx.drawImage(img, 0, 0);
  }

  // Step 2: Rotation (0, 90, 180, 270)
  const rotation = options.rotation ?? 0;
  if (rotation !== 0) {
    const rotCanvas = document.createElement("canvas");
    const rotCtx = rotCanvas.getContext("2d");
    if (!rotCtx) throw new Error("Could not create rotate canvas context");

    const w = workingCanvas.width;
    const h = workingCanvas.height;

    if (rotation === 90 || rotation === 270) {
      rotCanvas.width = h;
      rotCanvas.height = w;
    } else {
      rotCanvas.width = w;
      rotCanvas.height = h;
    }

    rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
    rotCtx.rotate((rotation * Math.PI) / 180);
    rotCtx.drawImage(workingCanvas, -w / 2, -h / 2);

    workingCanvas = rotCanvas;
    workingCtx = rotCtx;
  }

  // Step 3: Filters & Brightness/Contrast
  const finalW = workingCanvas.width;
  const finalH = workingCanvas.height;
  const imgData = workingCtx.getImageData(0, 0, finalW, finalH);

  if (options.filter && options.filter !== "original") {
    applyFilter(imgData.data, finalW, finalH, options.filter);
  }
  if (
    (options.brightness && options.brightness !== 1.0) ||
    (options.contrast && options.contrast !== 1.0)
  ) {
    applyBrightnessContrast(imgData.data, options.brightness ?? 1.0, options.contrast ?? 1.0);
  }
  workingCtx.putImageData(imgData, 0, 0);

  // Step 4: Export to JPEG Blob
  return new Promise<Blob>((resolve, reject) => {
    workingCanvas.toBlob(
      (res) => {
        if (res) resolve(res);
        else reject(new Error("Canvas toBlob failed"));
      },
      "image/jpeg",
      0.92,
    );
  });
}
