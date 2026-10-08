import type { Point } from "@/types/scanner";
export type DetectionCandidate = { corners: [Point, Point, Point, Point]; score: number };
/** Browser-CV integration point for scored quadrilateral contour detection. */
export function chooseBestCandidate(candidates: DetectionCandidate[]): DetectionCandidate | null { if (candidates.length === 0) return null; return [...candidates].sort((a, b) => b.score - a.score)[0] ?? null; }
