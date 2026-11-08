import { describe, expect, it } from 'vitest';
import { parseByteRange } from './range';

describe('authenticated PDF range validation', () => {
  it('reads exact byte offsets and total size', () => {
    expect(parseByteRange('bytes 0-99/1000')).toEqual({ begin: 0, end: 100, total: 1000 });
  });
  it('rejects missing, malformed, inverted and impossible ranges', () => {
    for (const header of [
      null,
      '',
      'bytes */100',
      'bytes 5-4/10',
      'bytes 0-10/10',
      'items 0-9/20',
    ]) {
      expect(() => parseByteRange(header)).toThrow();
    }
  });
});
