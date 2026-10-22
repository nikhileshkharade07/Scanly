import {
  distance,
  isConvexQuad,
  orderCorners,
  quadrilateralArea,
} from "./geometry";
import type { DetectResult, Point } from "@/types/scanner";

/** Compute angle between vector (p1 -> p2) and vector (p2 -> p3) in degrees. */
function angleBetween(p1: Point, p2: Point, p3: Point): number {
  const v1x = p1.x - p2.x;
  const v1y = p1.y - p2.y;
  const v2x = p3.x - p2.x;
  const v2y = p3.y - p2.y;

  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (mag1 < 1e-6 || mag2 < 1e-6) return 0;

  const cos = Math.min(1, Math.max(-1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Fast Sobel edge detection and gradient magnitude map.
 * Returns Uint8Array of gradient magnitudes scaled [0..255].
 */
export function computeSobelEdges(
  gray: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      // Sobel horizontal:
      // [-1, 0, 1]
      // [-2, 0, 2]
      // [-1, 0, 1]
      const gx =
        -gray[(y - 1) * width + (x - 1)] +
        gray[(y - 1) * width + (x + 1)] +
        -2 * gray[y * width + (x - 1)] +
        2 * gray[y * width + (x + 1)] +
        -gray[(y + 1) * width + (x - 1)] +
        gray[(y + 1) * width + (x + 1)];

      // Sobel vertical:
      // [-1, -2, -1]
      // [ 0,  0,  0]
      // [ 1,  2,  1]
      const gy =
        -gray[(y - 1) * width + (x - 1)] +
        -2 * gray[(y - 1) * width + x] +
        -gray[(y - 1) * width + (x + 1)] +
        gray[(y + 1) * width + (x - 1)] +
        2 * gray[(y + 1) * width + x] +
        gray[(y + 1) * width + (x + 1)];

      const mag = Math.min(255, Math.hypot(gx, gy) / 4);
      edges[idx] = Math.round(mag);
    }
  }

  return edges;
}

/** Check edge strength along a line segment between two points. */
function edgeStrengthAlongSegment(
  p1: Point,
  p2: Point,
  edges: Uint8Array,
  width: number,
  height: number,
  samples = 30,
): number {
  let sum = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = Math.round(p1.x + t * (p2.x - p1.x));
    const y = Math.round(p1.y + t * (p2.y - p1.y));
    if (x >= 0 && x < width && y >= 0 && y < height) {
      sum += edges[y * width + x];
    }
  }
  return sum / (samples + 1);
}

/**
 * Score a quadrilateral candidate based on:
 * - Area fraction (penalize if too small or covers entire image boundary)
 * - Rectangularity (corner angles close to 90 degrees)
 * - Edge gradient alignment
 * - Aspect ratio (standard document aspect ratios ~ 1:1 to 1:1.7)
 */
export function scoreQuadrilateral(
  corners: [Point, Point, Point, Point],
  edges: Uint8Array,
  imgWidth: number,
  imgHeight: number,
): number {
  if (!isConvexQuad(corners)) return 0;

  const totalArea = imgWidth * imgHeight;
  const area = quadrilateralArea(corners);
  const areaRatio = area / totalArea;

  // Documents should typically occupy between 12% and 95% of the frame
  if (areaRatio < 0.1 || areaRatio > 0.98) return 0;

  // Check 4 corner angles (ideally ~90 deg)
  const angles = [
    angleBetween(corners[3], corners[0], corners[1]),
    angleBetween(corners[0], corners[1], corners[2]),
    angleBetween(corners[1], corners[2], corners[3]),
    angleBetween(corners[2], corners[3], corners[0]),
  ];

  let angleScore = 0;
  for (const ang of angles) {
    const dev = Math.abs(ang - 90);
    // Score decays as angle departs from 90°
    angleScore += Math.max(0, 1 - dev / 45);
  }
  angleScore /= 4;
  if (angleScore < 0.4) return 0;

  // Aspect ratio check
  const wTop = distance(corners[0], corners[1]);
  const wBottom = distance(corners[3], corners[2]);
  const hLeft = distance(corners[0], corners[3]);
  const hRight = distance(corners[1], corners[2]);

  const avgW = (wTop + wBottom) / 2;
  const avgH = (hLeft + hRight) / 2;
  const aspect = Math.max(avgW / (avgH || 1), avgH / (avgW || 1));
  if (aspect > 3.0) return 0;

  // Edge support check
  const edgeScores = [
    edgeStrengthAlongSegment(corners[0], corners[1], edges, imgWidth, imgHeight),
    edgeStrengthAlongSegment(corners[1], corners[2], edges, imgWidth, imgHeight),
    edgeStrengthAlongSegment(corners[2], corners[3], edges, imgWidth, imgHeight),
    edgeStrengthAlongSegment(corners[3], corners[0], edges, imgWidth, imgHeight),
  ];
  const avgEdge = (edgeScores[0] + edgeScores[1] + edgeScores[2] + edgeScores[3]) / 4;
  const normEdgeScore = Math.min(1, avgEdge / 40);

  // Composite confidence score (0 to 1)
  const score = 0.4 * angleScore + 0.4 * normEdgeScore + 0.2 * Math.min(1, areaRatio * 1.5);
  return Number(score.toFixed(3));
}

/**
 * Searches for the strongest document polygon in the frame.
 * Operates on downscaled pixel buffer for real-time responsiveness.
 */
export function detectDocumentCorners(
  grayData: Uint8Array,
  width: number,
  height: number,
): DetectResult {
  const edges = computeSobelEdges(grayData, width, height);

  // Sample candidate quadrilaterals by raycasting from image quadrants and margins
  const candidates: { corners: [Point, Point, Point, Point]; score: number }[] = [];

  // Raycasting from center outward in 4 diagonal quadrants to find outer edge transitions
  const centerX = width / 2;
  const centerY = height / 2;

  function findEdgeAlongRay(
    startX: number,
    startY: number,
    dirX: number,
    dirY: number,
    threshold = 35,
  ): Point {
    const len = Math.hypot(width, height) / 2;
    let bestX = startX + dirX * len * 0.7;
    let bestY = startY + dirY * len * 0.7;
    let maxGrad = threshold;

    for (let d = 20; d < len; d += 4) {
      const x = Math.round(startX + dirX * d);
      const y = Math.round(startY + dirY * d);
      if (x < 4 || x >= width - 4 || y < 4 || y >= height - 4) break;
      const grad = edges[y * width + x];
      if (grad > maxGrad) {
        maxGrad = grad;
        bestX = x;
        bestY = y;
      }
    }
    return { x: bestX, y: bestY };
  }

  // Probe diagonal rays
  const tl = findEdgeAlongRay(centerX, centerY, -1, -1);
  const tr = findEdgeAlongRay(centerX, centerY, 1, -1);
  const br = findEdgeAlongRay(centerX, centerY, 1, 1);
  const bl = findEdgeAlongRay(centerX, centerY, -1, 1);

  const quad1 = orderCorners([tl, tr, br, bl]);
  const score1 = scoreQuadrilateral(quad1, edges, width, height);
  if (score1 > 0.35) {
    candidates.push({ corners: quad1, score: score1 });
  }

  // Probe standard document bounding candidates (inset 8%, 12%, 15%)
  for (const inset of [0.08, 0.12, 0.15]) {
    const insetCorners: [Point, Point, Point, Point] = [
      { x: width * inset, y: height * inset },
      { x: width * (1 - inset), y: height * inset },
      { x: width * (1 - inset), y: height * (1 - inset) },
      { x: width * inset, y: height * (1 - inset) },
    ];
    const s = scoreQuadrilateral(insetCorners, edges, width, height);
    if (s > 0.4) {
      candidates.push({ corners: insetCorners, score: s });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (!best || best.score < 0.4) {
    return {
      found: false,
      confidence: 0,
      corners: [],
      imageWidth: width,
      imageHeight: height,
    };
  }

  // Return normalized [0..1] coordinates: [[x, y], ...]
  const normalizedCorners = best.corners.map((p) => [
    Number((p.x / width).toFixed(4)),
    Number((p.y / height).toFixed(4)),
  ]) as [number, number][];

  return {
    found: true,
    confidence: best.score,
    corners: normalizedCorners,
    imageWidth: width,
    imageHeight: height,
  };
}
