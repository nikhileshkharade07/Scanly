export type Point = { x: number; y: number };
export type BoundingBox = { x: number; y: number; width: number; height: number };

export type OCRWord = { id: string; text: string; confidence: number; bbox: BoundingBox };
export type OCRLine = { id: string; text: string; confidence: number; bbox: BoundingBox; words: OCRWord[] };
export type OCRBlock = { id: string; type: string; text: string; confidence: number; bbox: BoundingBox; lines: OCRLine[] };
/** Structured OCR output. width/height are the pixel dimensions of the recognized image
 * (absent on records created before the C++ backend migration; bboxes are then unusable for overlays). */
export type OCRResult = {
  text: string;
  confidence: number;
  width?: number;
  height?: number;
  blocks: OCRBlock[];
};

export type FilterId = "original" | "grayscale" | "black-white" | "auto" | "contrast" | "sharpen";
export type Rotation = 0 | 90 | 180 | 270;

export type PageStatus = "draft" | "processing" | "ready" | "error";

export type ScanPage = {
  id: string;
  /** Untouched capture — never overwritten by processing. */
  originalImage: Blob;
  /** Result of perspective correction + enhancement (JPEG). */
  processedImage?: Blob;
  /** Small JPEG for fast library rendering. */
  thumbnail?: Blob;
  /** Detected/adjusted document corners as normalized [0..1] image coordinates,
   * ordered TL, TR, BR, BL. Matches the backend detect/process API directly. */
  corners?: [number, number][];
  filter: FilterId;
  rotation?: Rotation;
  /** User brightness/contrast multipliers (1 = unchanged). */
  brightness?: number;
  contrast?: number;
  ocr?: OCRResult;
  ocrLanguage?: string;
  /** Set when OCR failed so the UI can offer a retry without losing the page. */
  ocrError?: string;
  /** Processing pipeline status for UI feedback. */
  status?: PageStatus;
  createdAt: number;
};

export type DocumentStatus = "draft" | "saved";

export type DocumentRecord = {
  id: string;
  title: string;
  pages: ScanPage[];
  /** Derived from per-page OCR text; kept denormalized for fast search. */
  searchableText: string;
  status: DocumentStatus;
  thumbnail?: Blob;
  createdAt: number;
  updatedAt: number;
};

export type DetectResult = {
  found: boolean;
  confidence: number;
  /** Normalized [0..1] image coordinates, ordered TL, TR, BR, BL. Empty when found=false. */
  corners: [number, number][];
  imageWidth: number;
  imageHeight: number;
};
