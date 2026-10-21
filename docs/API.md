# Scanly C++ Backend API

The backend is a local, loopback-only C++ service (`127.0.0.1:8080` by default). It performs document
processing (detection, perspective correction, enhancement, OCR, searchable PDF). It is **stateless**:
no document bytes are written to disk and nothing is transmitted off the device.

Configuration (environment variables):

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCANLY_HOST` | `127.0.0.1` | Bind address (loopback only by default; privacy) |
| `SCANLY_PORT` | `8080` | TCP port |
| `SCANLY_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | CORS allowlist |
| `SCANLY_MAX_UPLOAD_MB` | `25` | Max request body size (validation) |
| `TESSDATA_PREFIX` | (bundled) | Tesseract language data location |

Error responses use:

```json
{ "error": { "code": "bad_image", "message": "Human-readable message" } }
```

Codes: `bad_request`, `bad_image`, `unsupported_media_type`, `too_large`, `unsupported_language`,
`ocr_failed`, `pdf_failed`, `internal`.

## Endpoints

### GET /api/health

```json
{ "status": "ok", "version": "0.2.0",
  "engine": { "opencv": "4.12.0", "tesseract": "5.5.3" },
  "languages": ["eng"] }
```

### GET /api/ocr/languages

`{ "languages": ["eng"] }` — Tesseract languages installed on this machine.

### POST /api/vision/detect

`multipart/form-data` with field `image` (JPEG/PNG/WebP bytes, ≤ max size).

Response:

```json
{ "found": true, "confidence": 0.87,
  "corners": [[0.12, 0.20], [0.85, 0.18], [0.88, 0.79], [0.10, 0.81]],
  "imageWidth": 4032, "imageHeight": 3024 }
```

- `corners` are normalized `[0..1]` image coordinates ordered TL, TR, BR, BL.
- `found: false` returns empty `corners` and `confidence: 0` (not an error).

### POST /api/image/process

`multipart/form-data`:

- `image` — source bytes (the untouched original).
- `options` — JSON string:
  ```json
  {
    "corners": [[0.12,0.20],[0.85,0.18],[0.88,0.79],[0.10,0.81]],
    "filter": "original|grayscale|black-white|auto|contrast|sharpen",
    "rotation": 0,
    "brightness": 1.0,
    "contrast": 1.0,
    "maxWidth": 2400
  }
  ```
  All keys optional except `filter` (defaults to `original`). `rotation` ∈ {0,90,180,270}.
  `brightness`/`contrast` ∈ [0.5, 2.0], 1 = unchanged.

Response: processed `image/jpeg` bytes.

Processing order: perspective warp (if corners) → rotation → filter → brightness/contrast →
optional downscale to `maxWidth`.

### POST /api/ocr

`multipart/form-data`: `image`, optional `lang` (default `eng`; must be in `/api/ocr/languages`).

Response: structured OCR matching the frontend `OCRResult` type:

```json
{ "text": "...", "confidence": 87.4, "width": 1600, "height": 2200,
  "blocks": [ { "id": "b0", "type": "text", "text": "...", "confidence": 87.4,
    "bbox": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "lines": [ { "id": "b0l0", "text": "...", "confidence": 90.1,
      "bbox": { "x": 10, "y": 20, "width": 300, "height": 28 },
      "words": [ { "id": "b0l0w0", "text": "Invoice", "confidence": 95.2,
        "bbox": { "x": 10, "y": 20, "width": 80, "height": 28 } } ] } ] } ] }
```

All bounding boxes are pixel coordinates in the submitted image; `width`/`height` give the image
dimensions so the client can map boxes to any display size. Confidence is 0–100.

### POST /api/pdf/searchable

`multipart/form-data`:

- `meta` — JSON string: `{ "title": "Doc", "pages": [ { "ocr": OCRResult | null } ] }`
- `page_0` … `page_N-1` — processed page images (JPEG/PNG), in page order.

Response: `application/pdf` — each page renders its scanned image with an invisible, selectable OCR
text layer positioned from word bounding boxes (PDF text render mode 3). Pages with `ocr: null`
are image-only. Non-Latin-1 glyphs are transliterated/replaced (documented limitation of the
base-14 font approach).

## Privacy

- The server binds to loopback; CORS is restricted to the configured dev origins.
- Request bodies are capped; images are decoded via hardened decoders; no file paths are accepted
  from clients; nothing is written to disk.
- Logs contain method/path/status/duration only — never OCR text or document bytes.
