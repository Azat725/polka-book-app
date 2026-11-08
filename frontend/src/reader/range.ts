export function parseByteRange(value: string | null): {
  begin: number;
  end: number;
  total: number;
} {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) throw new Error('Invalid PDF Content-Range');
  const begin = Number(match[1]),
    last = Number(match[2]),
    total = Number(match[3]);
  if (
    ![begin, last, total].every(Number.isSafeInteger) ||
    begin > last ||
    last >= total ||
    total > 100_000_000
  )
    throw new Error('Invalid PDF byte offsets');
  return { begin, end: last + 1, total };
}
