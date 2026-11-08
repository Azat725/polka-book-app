import { PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { authenticatedFetch } from '../shared/api';
import { parseByteRange } from './range';

export async function createPdfTransport(
  bookId: string,
  controller: AbortController,
  onError: () => void,
): Promise<PDFDataRangeTransport> {
  const path = `/books/${encodeURIComponent(bookId)}/file/`;
  async function request(begin: number, end: number) {
    const response = await authenticatedFetch(path, {
      headers: { Range: `bytes=${begin}-${end - 1}` },
      signal: controller.signal,
    });
    if (response.status !== 206) throw new Error('PDF byte ranges are unavailable');
    const range = parseByteRange(response.headers.get('Content-Range'));
    if (range.begin !== begin || range.end !== Math.min(end, range.total))
      throw new Error('Unexpected PDF range');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== range.end - begin) throw new Error('Incomplete PDF range');
    return { range, bytes };
  }
  const first = await request(0, 256 * 1024);
  class AuthenticatedTransport extends PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number): void {
      void request(begin, end)
        .then(({ range, bytes }) => {
          if (range.total !== first.range.total) throw new Error('PDF changed during reading');
          if (!controller.signal.aborted) this.onDataRange(begin, bytes);
        })
        .catch(() => {
          if (!controller.signal.aborted) onError();
        });
    }
    override abort(): void {
      controller.abort();
    }
  }
  return new AuthenticatedTransport(
    first.range.total,
    first.bytes,
    first.range.end === first.range.total,
  );
}
