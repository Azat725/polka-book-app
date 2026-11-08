export function markSearchText(layer: HTMLElement, query: string): HTMLElement | null {
  const spans = Array.from(layer.querySelectorAll<HTMLElement>('span:not(.markedContent)'));
  const segments: { span: HTMLElement; start: number; end: number }[] = [];
  let text = '';
  for (const span of spans) {
    delete span.dataset.readerMatch;
    const value = (span.textContent ?? '').replace(/\s+/g, ' ').toLocaleLowerCase();
    segments.push({ span, start: text.length, end: text.length + value.length });
    text += `${value} `;
  }
  const needle = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  if (!needle) return null;
  let match = text.indexOf(needle),
    segmentIndex = 0;
  let first: HTMLElement | null = null;
  while (match >= 0) {
    while (segmentIndex < segments.length && segments[segmentIndex].end <= match) segmentIndex++;
    for (
      let index = segmentIndex;
      index < segments.length && segments[index].start < match + needle.length;
      index++
    ) {
      segments[index].span.dataset.readerMatch = 'true';
      first ??= segments[index].span;
    }
    match = text.indexOf(needle, match + needle.length);
  }
  return first;
}
