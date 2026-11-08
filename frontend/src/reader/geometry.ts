export interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface PdfViewport {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export function rectToPdfQuad(
  rect: PageRect,
  viewport: Pick<PdfViewport, 'convertToPdfPoint'>,
): number[] {
  return [
    ...viewport.convertToPdfPoint(rect.left, rect.top),
    ...viewport.convertToPdfPoint(rect.left + rect.width, rect.top),
    ...viewport.convertToPdfPoint(rect.left, rect.top + rect.height),
    ...viewport.convertToPdfPoint(rect.left + rect.width, rect.top + rect.height),
  ];
}

export function pdfQuadToRect(
  quad: number[],
  viewport: Pick<PdfViewport, 'convertToViewportPoint'>,
): PageRect {
  const points = Array.from({ length: Math.floor(quad.length / 2) }, (_, i) =>
    viewport.convertToViewportPoint(quad[i * 2], quad[i * 2 + 1]),
  );
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const left = Math.min(...xs),
    top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export function clampPage(page: number, total: number): number {
  return Math.max(1, Math.min(Math.max(1, total), Math.trunc(Number.isFinite(page) ? page : 1)));
}

export function pageAnchor(scrollTop: number, pageTop: number, pageHeight: number): number {
  return Math.max(0, Math.min(1, (scrollTop - pageTop) / Math.max(1, pageHeight)));
}

export interface PageMetric {
  page: number;
  top: number;
  height: number;
}
export interface ReadingAnchor {
  page: number;
  position: number;
}

export function locatePageAnchor(scrollTop: number, pages: PageMetric[]): ReadingAnchor {
  if (!pages.length) return { page: 1, position: 0 };
  let low = 0,
    high = pages.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (pages[middle].top <= scrollTop + 30) low = middle;
    else high = middle - 1;
  }
  const page = pages[low];
  return { page: page.page, position: pageAnchor(scrollTop, page.top, page.height) };
}

export function anchorOffset(anchor: ReadingAnchor, pages: PageMetric[]): number {
  const page = pages.find((value) => value.page === anchor.page);
  return page ? page.top + Math.max(0, Math.min(1, anchor.position)) * page.height : 0;
}

export function decideSwipe(
  dx: number,
  dy: number,
  hasSelection: boolean,
  zoom: number,
): -1 | 0 | 1 {
  if (hasSelection || zoom > 1.02 || Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4)
    return 0;
  return dx < 0 ? 1 : -1;
}

export function readingInterval(
  previous: number,
  now: number,
  active: boolean,
  lastInteraction: number,
): number {
  if (!active || now - lastInteraction > 90_000) return 0;
  return Math.max(0, Math.min(30, Math.round((now - previous) / 1000)));
}

// Cylindrical bending preserves a page's arc length while its edge is turned.
export function curvePoint(x: number, progress: number): [number, number] {
  const p = Math.max(0, Math.min(1, progress));
  if (!p) return [x, 0];
  const theta = p * Math.PI;
  const radius = 1 / Math.max(0.001, theta);
  const bend = x * theta;
  return [
    Math.sin(bend) * radius * Math.cos(theta * 0.7),
    Math.max(0, (1 - Math.cos(bend)) * radius + Math.sin(theta) * x * 0.12),
  ];
}
