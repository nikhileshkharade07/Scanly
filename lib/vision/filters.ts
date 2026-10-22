import type { FilterId } from "@/types/scanner";

/** Apply brightness and contrast adjustments in-place. Brightness/contrast = 1 means unchanged. */
export function applyBrightnessContrast(
  data: Uint8ClampedArray,
  brightness = 1.0,
  contrast = 1.0,
): void {
  if (brightness === 1.0 && contrast === 1.0) return;
  const b = (brightness - 1.0) * 255;
  const c = contrast;

  for (let i = 0; i < data.length; i += 4) {
    // contrast factor around midpoint 128 + brightness shift
    data[i] = Math.min(255, Math.max(0, (data[i] - 128) * c + 128 + b));
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * c + 128 + b));
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * c + 128 + b));
  }
}

/** Converts pixel buffer to standard grayscale in-place. */
export function applyGrayscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
}

/** Computes Otsu's optimal threshold for binarization from a grayscale histogram. */
export function computeOtsuThreshold(grayData: Uint8ClampedArray): number {
  const histogram = new Array(256).fill(0);
  let totalPixels = 0;

  for (let i = 0; i < grayData.length; i += 4) {
    histogram[grayData[i]]++;
    totalPixels++;
  }

  if (totalPixels === 0) return 128;

  let sum = 0;
  for (let t = 0; t < 256; t++) {
    sum += t * histogram[t];
  }

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (weightB === 0) continue;

    const weightF = totalPixels - weightB;
    if (weightF === 0) break;

    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;

    const betweenVariance = weightB * weightF * (meanB - meanF) ** 2;
    if (betweenVariance > maxVariance) {
      maxVariance = betweenVariance;
      threshold = t;
    }
  }

  return threshold;
}

/** Converts pixel buffer to crisp Black & White (binarized for OCR/scanning). */
export function applyBlackAndWhite(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  // First ensure grayscale
  applyGrayscale(data);
  const threshold = computeOtsuThreshold(data);

  // Apply threshold
  for (let i = 0; i < data.length; i += 4) {
    const val = data[i] > threshold ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }
}

/** Contrast stretching with 1% and 99% percentile clipping. */
export function applyContrastStretching(data: Uint8ClampedArray): void {
  const histogram = new Array(256).fill(0);
  let total = 0;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[gray]++;
    total++;
  }

  if (total === 0) return;

  const lowCutoff = total * 0.02;
  const highCutoff = total * 0.98;

  let acc = 0;
  let minVal = 0;
  let maxVal = 255;

  for (let i = 0; i < 256; i++) {
    acc += histogram[i];
    if (acc >= lowCutoff && minVal === 0) minVal = i;
    if (acc >= highCutoff) {
      maxVal = i;
      break;
    }
  }

  const range = Math.max(1, maxVal - minVal);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, Math.round(((data[i] - minVal) / range) * 255)));
    data[i + 1] = Math.min(255, Math.max(0, Math.round(((data[i + 1] - minVal) / range) * 255)));
    data[i + 2] = Math.min(255, Math.max(0, Math.round(((data[i + 2] - minVal) / range) * 255)));
  }
}

/** Sharpen filter using standard 3x3 unsharp kernel. */
export function applySharpen(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const copy = new Uint8ClampedArray(data);
  // Kernel:
  // [  0, -1,  0 ]
  // [ -1,  5, -1 ]
  // [  0, -1,  0 ]
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];
        const top = copy[((y - 1) * width + x) * 4 + c];
        const bottom = copy[((y + 1) * width + x) * 4 + c];
        const left = copy[(y * width + (x - 1)) * 4 + c];
        const right = copy[(y * width + (x + 1)) * 4 + c];

        const val = 5 * center - top - bottom - left - right;
        data[idx + c] = Math.min(255, Math.max(0, val));
      }
    }
  }
}

/**
 * Auto enhancement filter:
 * 1. Levels uneven illumination / shadows
 * 2. Enhances document contrast
 * 3. Applies gentle sharpening for crisp typography
 */
export function applyAutoEnhance(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  // Contrast stretch
  applyContrastStretching(data);
  // Gentle brighten and contrast boost
  applyBrightnessContrast(data, 1.05, 1.15);
  // Mild sharpen
  applySharpen(data, width, height);
}

/** Applies a named filter to pixel data. */
export function applyFilter(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  filter: FilterId,
): void {
  switch (filter) {
    case "grayscale":
      applyGrayscale(data);
      break;
    case "black-white":
      applyBlackAndWhite(data, width, height);
      break;
    case "contrast":
      applyContrastStretching(data);
      break;
    case "sharpen":
      applySharpen(data, width, height);
      break;
    case "auto":
      applyAutoEnhance(data, width, height);
      break;
    case "original":
    default:
      break;
  }
}
