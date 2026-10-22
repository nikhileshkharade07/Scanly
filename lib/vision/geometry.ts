import type { Point } from "@/types/scanner";

/** Euclidean distance between two points. */
export function distance(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.hypot(dx, dy);
}

/**
 * Order four corners consistently as [Top-Left, Top-Right, Bottom-Right, Bottom-Left].
 * Points can be normalized [0..1] or in pixel coordinates.
 */
export function orderCorners(points: [Point, Point, Point, Point]): [Point, Point, Point, Point] {
  // Sort primarily by sum (x + y) and difference (y - x)
  // Top-left has the smallest sum (x + y)
  // Bottom-right has the largest sum (x + y)
  // Top-right has the smallest difference (y - x) -> largest (x - y)
  // Bottom-left has the largest difference (y - x)
  const sortedBySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = sortedBySum[0];
  const br = sortedBySum[3];

  const remaining = [sortedBySum[1], sortedBySum[2]];
  const sortedByDiff = remaining.sort((a, b) => a.x - a.y - (b.x - b.y));
  const bl = sortedByDiff[0];
  const tr = sortedByDiff[1];

  return [tl, tr, br, bl];
}

/** Shoelace formula to calculate area of a 4-point polygon. */
export function quadrilateralArea(corners: [Point, Point, Point, Point]): number {
  const [p0, p1, p2, p3] = corners;
  return (
    0.5 *
    Math.abs(
      p0.x * p1.y +
        p1.x * p2.y +
        p2.x * p3.y +
        p3.x * p0.y -
        (p1.x * p0.y + p2.x * p1.y + p3.x * p2.y + p0.x * p3.y),
    )
  );
}

/** Check if four ordered corners form a strictly convex polygon (no self-intersections or folded corners). */
export function isConvexQuad(corners: [Point, Point, Point, Point]): boolean {
  const n = 4;
  let prevSign = 0;
  for (let i = 0; i < n; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % n];
    const p3 = corners[(i + 2) % n];

    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) > 1e-7) {
      const sign = cross > 0 ? 1 : -1;
      if (prevSign === 0) {
        prevSign = sign;
      } else if (sign !== prevSign) {
        return false;
      }
    }
  }
  return prevSign !== 0;
}

/** Calculate target document output dimensions (width and height in px) from 4 corner pixel points. */
export function calculateOutputDimensions(
  corners: [Point, Point, Point, Point],
  maxDimension = 2400,
): { width: number; height: number } {
  const [tl, tr, br, bl] = corners;

  const widthTop = distance(tl, tr);
  const widthBottom = distance(bl, br);
  const rawWidth = Math.max(widthTop, widthBottom);

  const heightLeft = distance(tl, bl);
  const heightRight = distance(tr, br);
  const rawHeight = Math.max(heightLeft, heightRight);

  let width = Math.max(200, Math.round(rawWidth));
  let height = Math.max(200, Math.round(rawHeight));

  if (Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  return { width, height };
}

/**
 * Computes the 3x3 projective transformation matrix H that maps 4 source points to 4 destination points.
 * Returns an array of 9 coefficients: [h00, h01, h02, h10, h11, h12, h20, h21, h22].
 */
export function getProjectiveTransform(
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point],
): number[] {
  // Gaussian elimination to solve standard 8-DOF system Ah = b
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  // Solve 8x8 linear system via Gaussian elimination with partial pivoting
  const n = 8;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }
    const tempRow = A[i];
    A[i] = A[maxRow];
    A[maxRow] = tempRow;

    const tempB = b[i];
    b[i] = b[maxRow];
    b[maxRow] = tempB;

    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-10) {
      // Degenerate geometry; fallback to identity
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }

    for (let k = i + 1; k < n; k++) {
      const factor = A[k][i] / pivot;
      for (let j = i; j < n; j++) {
        A[k][j] -= factor * A[i][j];
      }
      b[k] -= factor * b[i];
    }
  }

  const h = new Array(9).fill(0);
  h[8] = 1;
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * h[j];
    }
    h[i] = sum / A[i][i];
  }

  return h;
}

/** Inverts a 3x3 matrix. */
export function invert3x3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  const invDet = 1.0 / det;
  return [
    A * invDet,
    D * invDet,
    G * invDet,
    B * invDet,
    E * invDet,
    H * invDet,
    C * invDet,
    F * invDet,
    I * invDet,
  ];
}
