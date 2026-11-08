import { describe, expect, it } from 'vitest';
import {
  clampPage,
  decideSwipe,
  pageAnchor,
  pdfQuadToRect,
  rectToPdfQuad,
  readingInterval,
  curvePoint,
  locatePageAnchor,
  anchorOffset,
} from './geometry';

const viewport = {
  convertToPdfPoint: (x: number, y: number) => [x / 2, (800 - y) / 2],
  convertToViewportPoint: (x: number, y: number) => [x * 2, 800 - y * 2],
};

describe('PDF annotation geometry', () => {
  it('round-trips a text selection through page coordinates rather than DOM offsets', () => {
    const quad = rectToPdfQuad({ left: 40, top: 80, width: 120, height: 28 }, viewport);
    expect(pdfQuadToRect(quad, viewport)).toEqual({ left: 40, top: 80, width: 120, height: 28 });
    const zoomed = { convertToViewportPoint: (x: number, y: number) => [x * 3, 1200 - y * 3] };
    expect(pdfQuadToRect(quad, zoomed)).toEqual({ left: 60, top: 120, width: 180, height: 42 });
  });

  it('calculates a bounding box after a rotated page transform', () => {
    const rotated = { convertToViewportPoint: (x: number, y: number) => [y, x] };
    expect(pdfQuadToRect([10, 20, 40, 20, 10, 30, 40, 30], rotated)).toEqual({
      left: 20,
      top: 10,
      width: 10,
      height: 30,
    });
  });
});

describe('reader navigation', () => {
  it('bounds invalid and out-of-range pages', () => {
    expect(clampPage(0, 20)).toBe(1);
    expect(clampPage(90, 20)).toBe(20);
    expect(clampPage(Number.NaN, 20)).toBe(1);
    expect(clampPage(2.9, 20)).toBe(2);
  });

  it('stores a normalized anchor independent of rendered height', () => {
    expect(pageAnchor(650, 150, 1000)).toBe(0.5);
    expect(pageAnchor(100, 150, 1000)).toBe(0);
    expect(pageAnchor(1500, 150, 1000)).toBe(1);
  });

  it('does not turn a page during text selection, zoom, vertical scrolling or a cancelled swipe', () => {
    expect(decideSwipe(-120, 10, false, 1)).toBe(1);
    expect(decideSwipe(120, 10, false, 1)).toBe(-1);
    expect(decideSwipe(25, 0, false, 1)).toBe(0);
    expect(decideSwipe(120, 150, false, 1)).toBe(0);
    expect(decideSwipe(120, 0, true, 1)).toBe(0);
    expect(decideSwipe(120, 0, false, 1.4)).toBe(0);
  });

  it('never counts a background or long idle interval as active reading', () => {
    expect(readingInterval(1000, 16000, true, 15000)).toBe(15);
    expect(readingInterval(1000, 16000, false, 15000)).toBe(0);
    expect(readingInterval(1000, 160000, true, 2000)).toBe(0);
    expect(readingInterval(1000, 120000, true, 119000)).toBe(30);
  });

  it('keeps a flat page before a curl and deforms it continuously during a turn', () => {
    expect(curvePoint(0.5, 0)).toEqual([0.5, 0]);
    const point = curvePoint(0.5, 0.5);
    expect(point.every(Number.isFinite)).toBe(true);
    expect(point[1]).toBeGreaterThan(0);
  });

  it('preserves the visible anchor when mixed portrait/landscape placeholder heights settle', () => {
    const initial = [
      { page: 1, top: 20, height: 1000 },
      { page: 2, top: 1066, height: 1000 },
      { page: 3, top: 2112, height: 1000 },
    ];
    const anchor = locatePageAnchor(1566, initial);
    expect(anchor).toEqual({ page: 2, position: 0.5 });
    const settled = [
      { page: 1, top: 20, height: 700 },
      { page: 2, top: 766, height: 1400 },
      { page: 3, top: 2212, height: 1000 },
    ];
    expect(anchorOffset(anchor, settled)).toBe(1466);
    expect(locatePageAnchor(anchorOffset(anchor, settled), settled)).toEqual(anchor);
  });

  it('restores a target page with an actual height rather than a stale estimated height', () => {
    const pages = [
      { page: 1, top: 20, height: 1200 },
      { page: 2, top: 1266, height: 600 },
    ];
    expect(anchorOffset({ page: 2, position: 0.75 }, pages)).toBe(1716);
    expect(locatePageAnchor(1716, pages)).toEqual({ page: 2, position: 0.75 });
    expect(locatePageAnchor(0, [])).toEqual({ page: 1, position: 0 });
  });
});
