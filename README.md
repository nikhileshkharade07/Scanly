# Scanly

**Privacy-first, local-first OCR document scanner.**

Scanly is designed around the flow:

**Camera / Upload → document detection → perspective correction → enhancement → OCR → review/edit → local library → search → searchable PDF**

The MVP is intended to work without a backend, account, API key, or cloud service, with documents and OCR data remaining on the user's device.

## Status

Initial engineering foundation: app shell, camera entry point, typed domain model, IndexedDB/Dexie repository, search utilities, testing setup, and architecture boundaries. The full scanner pipeline is intentionally not faked; it should be implemented incrementally.

## Stack

- Next.js + React + TypeScript + App Router
- Tailwind CSS
- IndexedDB via Dexie
- Tesseract.js for OCR
- OpenCV.js (or equivalent browser CV) for detection/perspective correction
- Web Workers for expensive OCR/image work
- Client-side PDF generation
- Vitest + Playwright for testing

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

## Structure

```text
app/                 Routes and application shell
components/          Reusable UI and feature components
hooks/               Client-side feature hooks
lib/camera/          Camera access and capture
lib/vision/          Detection, geometry, perspective correction
lib/ocr/             Tesseract workers and OCR parsing
lib/storage/         IndexedDB/Dexie repository
lib/pdf/             Searchable PDF generation
lib/search/          Full-text search
lib/utils/           Shared utilities
types/               Domain models
tests/               Unit/integration tests
docs/                Product and engineering specifications
```

## Privacy rules

- No document content should be uploaded to a server in the MVP.
- No mandatory authentication.
- No analytics transmitting document contents.
- Preserve originals separately from processed images and editable OCR.
- Document any dependency that requires network access.

## Build prompt

The full autonomous implementation prompt is in [`docs/MASTER_PROMPT.md`](./docs/MASTER_PROMPT.md).
