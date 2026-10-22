import { describe, expect, it } from "vitest";
import {
  applyAutoEnhance,
  applyBlackAndWhite,
  applyBrightnessContrast,
  applyFilter,
  applyGrayscale,
  computeOtsuThreshold,
} from "@/lib/vision/filters";

describe("image filters", () => {
  it("converts RGB values to correct grayscale luminance", () => {
    // Red pixel (255, 0, 0, 255) -> 0.299 * 255 = 76
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    applyGrayscale(data);
    expect(data[0]).toBe(76);
    expect(data[1]).toBe(76);
    expect(data[2]).toBe(76);
  });

  it("computes Otsu threshold for bimodal distribution", () => {
    // Two clusters: dark pixels (30) and bright pixels (220)
    const pixels = new Uint8ClampedArray([
      30, 30, 30, 255,
      30, 30, 30, 255,
      220, 220, 220, 255,
      220, 220, 220, 255,
    ]);
    const threshold = computeOtsuThreshold(pixels);
    expect(threshold).toBeGreaterThanOrEqual(30);
    expect(threshold).toBeLessThanOrEqual(220);
  });

  it("binarizes image in black-white mode", () => {
    const data = new Uint8ClampedArray([
      20, 20, 20, 255,
      240, 240, 240, 255,
    ]);
    applyBlackAndWhite(data, 2, 1);
    expect(data[0]).toBe(0);
    expect(data[4]).toBe(255);
  });

  it("adjusts brightness and contrast in-place", () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyBrightnessContrast(data, 1.2, 1.0);
    expect(data[0]).toBeGreaterThan(100);
  });

  it("handles auto filter gracefully", () => {
    // 3x3 test image
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 120;
      data[i + 1] = 130;
      data[i + 2] = 140;
      data[i + 3] = 255;
    }
    applyFilter(data, 3, 3, "auto");
    expect(data[3]).toBe(255);
  });
});
