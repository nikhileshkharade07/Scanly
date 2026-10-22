import { describe, expect, it } from "vitest";
import { computeSobelEdges, detectDocumentCorners, scoreQuadrilateral } from "@/lib/vision/detector";
import type { Point } from "@/types/scanner";

describe("document boundary detector", () => {
  it("computes Sobel edge gradients accurately", () => {
    // 5x5 image with a sharp vertical edge at x = 2
    const width = 5;
    const height = 5;
    const gray = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        gray[y * width + x] = x < 2 ? 0 : 255;
      }
    }

    const edges = computeSobelEdges(gray, width, height);
    // At x = 2, horizontal gradient should be strong
    const centerGrad = edges[2 * width + 2];
    expect(centerGrad).toBeGreaterThan(50);
  });

  it("scores quadrilateral candidates with high confidence on valid rectangles", () => {
    const width = 100;
    const height = 100;
    const edges = new Uint8Array(width * height).fill(40);

    const corners: [Point, Point, Point, Point] = [
      { x: 15, y: 15 },
      { x: 85, y: 15 },
      { x: 85, y: 85 },
      { x: 15, y: 85 },
    ];

    const score = scoreQuadrilateral(corners, edges, width, height);
    expect(score).toBeGreaterThan(0.4);
  });

  it("returns zero score for non-convex or microscopic candidates", () => {
    const width = 100;
    const height = 100;
    const edges = new Uint8Array(width * height).fill(50);

    // Microscopic quad (area ratio < 1%)
    const tinyCorners: [Point, Point, Point, Point] = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ];
    expect(scoreQuadrilateral(tinyCorners, edges, width, height)).toBe(0);
  });
});
