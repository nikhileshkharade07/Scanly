import { describe, expect, it } from "vitest";
import {
  calculateOutputDimensions,
  distance,
  getProjectiveTransform,
  invert3x3,
  isConvexQuad,
  orderCorners,
  quadrilateralArea,
} from "@/lib/vision/geometry";
import type { Point } from "@/types/scanner";

describe("geometry utilities", () => {
  it("calculates euclidean distance correctly", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
  });

  it("orders corners consistently as [TL, TR, BR, BL]", () => {
    const unarranged: [Point, Point, Point, Point] = [
      { x: 100, y: 100 }, // BR
      { x: 0, y: 100 },   // BL
      { x: 0, y: 0 },     // TL
      { x: 100, y: 0 },   // TR
    ];
    const [tl, tr, br, bl] = orderCorners(unarranged);
    expect(tl).toEqual({ x: 0, y: 0 });
    expect(tr).toEqual({ x: 100, y: 0 });
    expect(br).toEqual({ x: 100, y: 100 });
    expect(bl).toEqual({ x: 0, y: 100 });
  });

  it("calculates area using shoelace formula", () => {
    const corners: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(quadrilateralArea(corners)).toBe(200);
  });

  it("identifies convex quadrilaterals and rejects self-intersecting ones", () => {
    const valid: [Point, Point, Point, Point] = [
      { x: 10, y: 10 },
      { x: 90, y: 15 },
      { x: 85, y: 95 },
      { x: 5, y: 80 },
    ];
    expect(isConvexQuad(valid)).toBe(true);

    // Bowtie shape (self-intersecting)
    const bowtie: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(isConvexQuad(bowtie)).toBe(false);
  });

  it("calculates sensible output dimensions", () => {
    const corners: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 1200 },
      { x: 0, y: 1200 },
    ];
    const { width, height } = calculateOutputDimensions(corners);
    expect(width).toBe(800);
    expect(height).toBe(1200);
  });

  it("computes projective transform and maps points accurately", () => {
    const src: [Point, Point, Point, Point] = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 120 },
      { x: 10, y: 120 },
    ];
    const dst: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];

    const H = getProjectiveTransform(src, dst);
    expect(H).toHaveLength(9);

    // Map src[0] through H
    const x = src[0].x;
    const y = src[0].y;
    const mappedX = (H[0] * x + H[1] * y + H[2]) / (H[6] * x + H[7] * y + H[8]);
    const mappedY = (H[3] * x + H[4] * y + H[5]) / (H[6] * x + H[7] * y + H[8]);

    expect(mappedX).toBeCloseTo(dst[0].x, 2);
    expect(mappedY).toBeCloseTo(dst[0].y, 2);
  });

  it("inverts 3x3 matrices accurately", () => {
    const m = [1, 2, 0, 0, 1, 1, 2, 0, 1];
    const inv = invert3x3(m);

    // Multiply m by inv -> should approximate identity
    const id00 = m[0] * inv[0] + m[1] * inv[3] + m[2] * inv[6];
    const id11 = m[3] * inv[1] + m[4] * inv[4] + m[5] * inv[7];
    const id22 = m[6] * inv[2] + m[7] * inv[5] + m[8] * inv[8];

    expect(id00).toBeCloseTo(1, 5);
    expect(id11).toBeCloseTo(1, 5);
    expect(id22).toBeCloseTo(1, 5);
  });
});
