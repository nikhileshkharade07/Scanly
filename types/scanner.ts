export type Point = { x: number; y: number };
export type BoundingBox = { x: number; y: number; width: number; height: number };
export type OCRWord = { id: string; text: string; confidence: number; bbox: BoundingBox };
export type OCRLine = { id: string; text: string; confidence: number; bbox: BoundingBox; words: OCRWord[] };
export type OCRBlock = { id: string; type: string; text: string; confidence: number; bbox: BoundingBox; lines: OCRLine[] };
export type OCRResult = { text: string; confidence: number; blocks: OCRBlock[] };
export type ScanPage = { id: string; originalImage: Blob; processedImage?: Blob; corners?: [Point, Point, Point, Point]; filter: "original" | "auto" | "grayscale" | "black-white"; ocr?: OCRResult; createdAt: number };
export type DocumentRecord = { id: string; title: string; pages: ScanPage[]; searchableText: string; createdAt: number; updatedAt: number; };
