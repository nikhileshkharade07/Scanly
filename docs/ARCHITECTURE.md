# Scanly Architecture

## Principles

1. Local-first: document bytes and OCR remain in the browser.
2. Separation of concerns: camera, CV, OCR, storage, search, PDF, and UI are separate modules.
3. Preserve source data: original images are never destroyed by processing.
4. Workers for expensive work: OCR and intensive image processing must not block the UI.
5. Real fallbacks: unsupported camera hardware should fall back to image upload instead of crashing.

## Pipeline

```text
Camera / File
    ↓
Capture + Original Blob
    ↓
Document Detection
    ↓
Corner Editor
    ↓
Perspective Transform
    ↓
Filter / Enhancement
    ↓
OCR Worker
    ↓
Structured OCRResult
    ↓
IndexedDB
    ├── Library / Search
    └── PDF / TXT / Image export
```

## Data ownership

`DocumentRecord` owns document metadata and pages. Each page keeps its original image blob, optional processed image blob, corner geometry, selected filter, and structured OCR result.
