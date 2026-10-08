Yes — give Claude Code one strong **master prompt** rather than feeding it 10 smaller prompts. This version tells it to build the product end-to-end, make sensible decisions autonomously, and keep iterating until the app is actually usable.

Master Claude Code Prompt — OCR Document Scanner

You are the lead engineer, product designer, and QA engineer for this project.

Build a production-quality, local-first OCR document scanner called **Scanly** from scratch.

Do not just create a demo, mockup, landing page, or skeleton. Build the actual working application end-to-end.

Your job is to make reasonable technical and product decisions without repeatedly asking me for confirmation. If something is ambiguous, choose the simplest robust implementation that fits the product vision.

# PRODUCT

Scanly is a privacy-first document scanning application.

The primary experience is:

Camera / Upload → detect document → capture → automatically crop and straighten → enhance scan → OCR → review/edit text → save document → search later → export as searchable PDF

The application should feel like a polished native document scanner rather than a generic web dashboard.

The MVP must work without requiring a backend, account, API key, or cloud service.

All documents and OCR data should remain on the user's device.

# CORE FEATURES

Implement all of the following:

1. Camera scanning
2. Image upload from device
3. Automatic document boundary detection
4. Automatic perspective correction
5. Manual corner adjustment
6. Scan enhancement
7. Original / Auto / Grayscale / Black & White filters
8. OCR
9. Word-level OCR bounding boxes
10. OCR confidence scores
11. Editable extracted text
12. Multi-page documents
13. Reorder pages
14. Delete pages
15. Rename documents
16. Document thumbnails
17. Local document library
18. Full-text document search
19. Search result highlighting where practical
20. Searchable PDF export
21. TXT export
22. Image export
23. Delete documents
24. Offline/local-first behavior
25. Responsive mobile-first UI
26. Dark mode
27. Good loading/error/empty states
28. Accessibility
29. PWA support
30. No mandatory login

# TECH STACK

Use:

- Next.js
- React
- TypeScript
- App Router
- Tailwind CSS
- shadcn/ui where useful
- IndexedDB for local persistence
- OpenCV.js or another browser-compatible computer vision implementation for document detection/perspective correction
- Tesseract.js for OCR
- Web Workers for OCR and expensive image processing
- Canvas APIs where appropriate
- A reliable client-side PDF library for PDF creation

Use pnpm.

Do not introduce a backend unless absolutely necessary.

Do not introduce a database server.

Do not require external API keys.

# IMPORTANT ARCHITECTURE PRINCIPLE

Keep these systems separate:

- Camera
- Image capture
- Document detection
- Perspective correction
- Image enhancement
- OCR
- OCR parsing/layout
- Local storage
- PDF generation
- Search
- UI

Do not put everything into page.tsx or one giant React component.

Create clean reusable modules.

Prefer simple, understandable code over unnecessary abstraction.

# PROJECT STRUCTURE

Use a structure approximately like:

app/ page.tsx scan/ page.tsx document/ [id]/ page.tsx settings/ page.tsx

components/ scanner/ documents/ ocr/ pdf/ ui/

lib/ camera/ vision/ ocr/ storage/ pdf/ search/ utils/

hooks/ use-camera.ts use-scanner.ts use-ocr.ts use-documents.ts

types/

tests/

You may improve this structure if you have a better well-justified organization.

# DATA MODEL

Create strongly typed models.

Use concepts similar to:

Point: x y

BoundingBox: x y width height

OCRWord: id text confidence bbox

OCRLine: id text confidence bbox words

OCRBlock: id type text confidence bbox lines

OCRResult: text confidence blocks

ScanPage: id originalImage processedImage corners filter ocr createdAt

Document: id title pages searchableText createdAt updatedAt totalPages

Use Blob storage for images.

Do NOT store large images as giant base64 strings unless there is a compelling technical reason.

# HOME SCREEN

Build a polished mobile-first home screen.

It should contain:

- Scanly branding
- Search bar
- Large "Scan document" button
- Recent documents
- Document thumbnails
- Empty state when there are no documents
- Settings access

The Scan button should be the primary visual action.

Desktop should adapt gracefully rather than simply looking like a stretched mobile UI.

# CAMERA EXPERIENCE

Create a fullscreen/mobile-friendly scanner.

Include:

- Live camera preview
- Rear/environment camera preference on mobile
- Capture button
- Upload/gallery button
- Close/back button
- Flash control only if the browser/device genuinely supports it
- Document detection overlay
- Clear capture state

Handle:

- camera permission denied
- camera unavailable
- unsupported browsers
- no rear camera
- upload fallback

Never crash if browser camera APIs are unavailable.

# DOCUMENT DETECTION

Implement real document detection.

Use computer vision.

The detector should:

1. Resize frames for performance.
2. Convert to grayscale.
3. Reduce noise.
4. Detect edges.
5. Find contours.
6. Find quadrilateral candidates.
7. Score candidates based on:
   - area
   - rectangularity
   - edge strength
   - aspect ratio
   - position
8. Return the strongest reliable candidate.
9. Return no detection when confidence is poor.

Do not assume the largest contour is always the document.

Real-world images may contain:

- desks
- laptops
- books
- screens
- shadows
- hands
- multiple rectangles

Detection must be robust enough for ordinary documents.

Do not run expensive full-resolution detection continuously.

Throttle detection appropriately.

Map detection coordinates correctly to the displayed camera dimensions.

Visual states:

No detection: subtle white guide

Possible detection: yellow/orange outline

Strong detection: green outline

# CAPTURE

When the user captures an image:

- preserve the original image
- detect the document
- show the detected corners
- allow the user to correct corners manually
- allow retake
- allow accepting the scan

Do not automatically destroy the original.

# MANUAL CORNER EDITOR

Create a touch-friendly corner editor.

Display four draggable corner handles.

Requirements:

- large touch targets
- smooth dragging
- correct coordinate transformation
- prevent impossible geometry where practical
- support mouse and touch
- show preview of the corrected document

Buttons:

Retake Use scan

# PERSPECTIVE CORRECTION

Implement a proper perspective transform.

The output should:

- straighten the document
- preserve readability
- calculate sensible output dimensions
- avoid unnecessary upscaling
- maintain good resolution

Handle:

- rotated documents
- perspective distortion
- imperfect corners
- corners close to image boundaries

# IMAGE ENHANCEMENT

Implement:

Original Auto Grayscale Black & White

Auto should improve:

- contrast
- readability
- mild shadows
- background noise
- uneven lighting

Do not make colored documents unusable.

Let the user preview filters.

# OCR

Use Tesseract.js.

OCR must run in a Web Worker.

Do not freeze the UI.

Requirements:

- lazy-load OCR resources
- show progress
- support cancellation
- handle errors
- produce word-level bounding boxes
- produce confidence scores
- construct lines
- construct blocks where practical
- generate normalized plain text
- preserve page coordinates

Do not merely return one giant OCR string.

Low-confidence text should be identifiable.

For example:

90+ confidence: normal

70–89: subtle warning

below 70: visually indicate uncertainty

Never fabricate text.

If OCR fails, preserve the scanned page and allow Retry OCR.

# OCR EDITOR

Create an editable text view.

The user should be able to:

- edit OCR text
- correct mistakes
- copy text
- select all
- save changes

Do not overwrite the original scan image.

Keep OCR data and scanned images separate.

# MULTI-PAGE SCANNING

Support:

Scan page 1 → Add another page → Scan page 2 → Add another page → Done

The user must be able to:

- reorder pages
- delete pages
- preview pages
- retake individual pages where practical

If OCR fails on one page, do not lose the other pages.

# DOCUMENT VIEWER

Create a polished document viewer.

Desktop layout can use:

left: page preview

right: OCR text

Mobile should use a stacked layout.

Actions:

- Edit text
- Search
- Export PDF
- Export TXT
- Export image
- Share/download where supported
- Delete

Show page count.

Show document title.

Allow renaming.

# LOCAL STORAGE

Use IndexedDB.

Create a clean repository layer.

Support:

createDocument() getDocument() listDocuments() updateDocument() deleteDocument() searchDocuments()

Persist:

- document metadata
- page metadata
- original images
- processed images
- OCR JSON
- searchable text

Documents must survive:

- refresh
- browser restart
- offline use

Use IndexedDB schema/version migrations.

Do not let UI components directly manipulate raw IndexedDB APIs.

# SEARCH

Implement full-text search across saved OCR text.

Search should:

- be fast
- ignore case
- handle whitespace sensibly
- return document matches
- show snippets where possible
- highlight matching text where practical

Example:

Search: "invoice"

Results:

Invoice March "...monthly invoice amount..."

Electricity Bill "...invoice number..."

Clicking a result should open the relevant document.

If OCR coordinates make it practical, highlight the matching area on the scanned page.

# PDF

Implement actual searchable PDF generation.

Each PDF page should contain:

1. The processed document image.
2. A selectable/searchable OCR text layer positioned approximately according to OCR bounding boxes.

Do not merely put the image into a PDF and call it searchable.

Support:

- multiple pages
- correct page order
- reasonable image quality
- OCR text layer
- download

Also support:

- TXT export
- image export

Everything should happen client-side.

# PWA

Make the app installable as a PWA where practical.

Implement:

- app manifest
- service worker/offline caching
- icons/placeholders if needed
- sensible offline behavior

Do not cache user document data in an unsafe way.

The application shell should work offline.

# PRIVACY

Privacy is a core product feature.

The application must NOT upload:

- document images
- OCR text
- PDFs

to a server in the MVP.

Do not add analytics that transmit document contents.

Do not add hidden network calls.

If an external dependency requires network access, document it clearly.

# ERROR HANDLING

Every important async operation must have:

- loading state
- success state
- failure state
- retry option where appropriate

Important examples:

Camera unavailable OCR failed PDF generation failed Storage failed Invalid image Document detection failed

Never silently lose user data.

If OCR fails:

save the document anyway.

If PDF generation fails:

keep the document intact.

# UX

The application should feel premium.

Design language:

- minimal
- calm
- modern
- utility-focused
- fast
- excellent typography
- strong hierarchy
- subtle animation
- mobile-first

Avoid:

- excessive gradients
- generic SaaS dashboards
- unnecessary cards
- excessive rounded containers
- fake AI aesthetics
- unnecessary animations

The scanner should feel like a serious native utility.

Use animations only when they improve feedback.

Respect prefers-reduced-motion.

# RESPONSIVE DESIGN

Test and optimize for:

360px 390px 430px 768px 1024px 1440px

Mobile is the primary scanning experience.

Desktop should still be excellent for browsing and editing documents.

# ACCESSIBILITY

Implement:

- keyboard navigation
- visible focus states
- semantic HTML
- accessible buttons
- appropriate labels
- useful ARIA only where needed
- sufficient contrast
- reduced-motion support

Touch targets should be appropriately sized.

# PERFORMANCE

Pay particular attention to:

- camera frame processing
- OCR
- large images
- IndexedDB
- PDF generation

Use:

- Web Workers
- reduced-resolution detection frames
- lazy loading
- appropriate image resizing
- Blob storage

Do not load OCR resources before they are needed.

Do not process full-resolution frames continuously.

# TESTING

Create meaningful tests.

Unit tests for:

- corner ordering
- coordinate transforms
- document candidate scoring
- OCR parsing
- OCR normalization
- search
- storage repository
- document operations

Integration tests for:

- capture → process
- OCR → save
- multi-page documents
- document search
- export

E2E tests using Playwright for the major user flows.

Where real camera hardware is unavailable, mock the camera/input layer.

Do not make tests dependent on an actual physical camera.

# DEVELOPMENT APPROACH

You have permission to make implementation decisions autonomously.

Do not stop after creating the scaffold.

Build the entire product in logical stages.

Recommended sequence:

1. Project setup
2. App shell
3. Local storage
4. Camera/upload
5. Document detection
6. Perspective correction
7. Image enhancement
8. OCR
9. OCR editor
10. Multi-page scanning
11. Document viewer
12. Search
13. PDF export
14. PWA/offline support
15. Accessibility
16. Performance optimization
17. Visual polish
18. Testing
19. Final cleanup

After each major stage:

- run type checking
- run lint
- run tests
- fix errors
- continue

Do not stop merely because one milestone is complete.

# IMPORTANT VIBE-CODING RULE

I want you to behave like an autonomous senior engineer.

Do not repeatedly ask me:

"Should I use X or Y?"

Make the best reasonable decision.

Only ask me if a decision fundamentally changes the product and cannot reasonably be inferred.

Otherwise choose, implement, test, and continue.

Do not create fake functionality.

If a feature cannot be fully implemented with the chosen stack, implement the best real fallback and clearly document the limitation.

# CODE QUALITY

Use strict TypeScript.

Avoid `any`.

Avoid unnecessary dependencies.

Avoid duplicated logic.

Keep functions reasonably small.

Use meaningful names.

Add comments only where they explain non-obvious decisions.

Do not over-engineer.

Do not rewrite working code unnecessarily.

# FINAL ACCEPTANCE CRITERIA

Do not consider the project complete until a user can perform this entire journey:

1. Open Scanly.
2. Tap Scan document.
3. Grant camera permission.
4. See live camera.
5. Point camera at a physical document.
6. See document detection.
7. Capture it.
8. Adjust corners if detection is imperfect.
9. Apply Auto enhancement.
10. Run OCR.
11. See OCR progress.
12. Review extracted text.
13. Correct OCR mistakes.
14. Save the document.
15. Add another page.
16. Save a multi-page document.
17. Close/reload the application.
18. Find the document in the library.
19. Search for text inside it.
20. Open the document.
21. Edit its OCR text.
22. Export a searchable PDF.
23. Open the PDF in a PDF viewer.
24. Select/search the OCR text.
25. Export TXT.
26. Delete the document.

The app must preserve the user's scanned images throughout this process.

# FINAL TASK

Start by inspecting the current repository.

If it is empty, initialize the project.

Then implement the application end-to-end.

Do not just tell me how to build it.

Actually build it.

Run the relevant commands yourself.

Fix errors yourself.

At the end, provide:

1. What you built
2. Important architectural decisions
3. Files/components created
4. Commands used to run it
5. Tests performed
6. Any remaining limitations
7. The next 3 highest-value improvements

Most importantly:

**Keep going until there is a genuinely usable OCR document scanner, not merely a scaffold.**

### One tip before you run it

Start Claude Code **inside an empty Git repository**, paste that entire prompt, and let it work through the implementation. If it starts trying to build a fancy landing page before the scanner works, interrupt it and say:

> **Prioritize the actual scanning pipeline over marketing/UI polish. Continue until camera → detection → correction → OCR → save → search → PDF works end-to-end.**

That keeps the agent focused on the actual product rather than spending its context budget making a pretty dashboard.