# PDF reader

`Reader` is a lazy-loaded React screen backed by the real PDF.js document engine. Production does not substitute sample pages for a failed document.

## Rendering and file access

- `transport.ts` requests bounded byte ranges through `authenticatedFetch`, so an expired access token can be refreshed before the next range. It rejects mismatched or missing `Content-Range` headers.
- `PdfPage.tsx` renders the current page and nearby pages only. Off-screen slots preserve document layout without keeping a canvas for every page.
- PDF canvas pixels are capped independently of the PDF file size. Text remains a separate selectable layer, with PDF.js viewport transforms.
- Highlight quadrilaterals use PDF page coordinates. Zoom and rotation remap those coordinates; text prefix/suffix provide additional anchors. Original file versions are immutable on the server.
- A password is supplied directly to PDF.js. It is not sent to the API, persisted in IndexedDB, or included in logs.

## Reading state

`useProgress` keeps pending positions in IndexedDB and synchronizes them with idempotent mutation IDs and revisions. Page changes are queued immediately. Scroll events update an in-memory latest anchor immediately and persist semantic changes at a 100 ms cadence; closing the screen also queues the latest anchor. Network synchronization normally runs every 3.5 seconds.

`reader-back` is a cancelable window event used by the Telegram integration. It first closes the active reader panel, preserves unresolved conflicts, and then closes the book through the reader's save path.

The platform may terminate a WebView before an IndexedDB transaction commits. No browser event can guarantee that the very last movement survives a process kill. Storage errors are shown rather than reported as successful offline synchronization.

`useBookSettings` separates book overrides (`reader_mode`, brightness, contrast, night mode, animation speed, zoom, fit mode) from global sound preferences. Book PATCH requests include the book-settings revision. A conflicting server version requires an explicit choice.

## Page turn

`curl.ts` dynamically imports Three.js only when needed, creates a temporary texture of the current page, bends a segmented mesh, then releases renderer/geometry/material/texture resources. The regular PDF canvas and selectable text return after the turn. Text interaction is temporarily disabled during the transition.

Swipes are recognized at the page edges and start an eased turn on release. The curl does not continuously follow a dragged finger. A cancelled or short gesture leaves the page unchanged. Zoomed documents use panning and explicit navigation buttons; reduced motion and unavailable WebGL use the simpler transition.

Real Telegram iOS/Android devices still require hardware checks for GPU limits, selection handles, keyboard/safe-area behavior, and pinch gestures. Browser E2E checks do not replace these tests.

## Audio

`sound.ts` synthesizes a short paper-like noise after a user action. It does not distribute third-party audio. Only one page sound plays at a time. Audio failures never block navigation.

## Tests

Reader unit tests cover coordinate transforms, gesture decisions, range validation, progress durability/conflicts, dialog keyboard behavior, and per-book settings. Full-stack Playwright tests live in the frontend `e2e` directory and use actual PDFs and backend responses.
