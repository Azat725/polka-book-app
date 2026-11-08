import { describe, expect, it } from 'vitest';
import { markSearchText } from './search';

describe('PDF text search highlighting', () => {
  it('finds a phrase split between separate PDF text items', () => {
    const layer = document.createElement('div');
    layer.innerHTML =
      '<span>First paragraph</span><span>Important</span><span>words here</span><span>Last paragraph</span>';
    const match = markSearchText(layer, 'important words');
    expect(match?.textContent).toBe('Important');
    expect(layer.querySelectorAll('[data-reader-match=true]')).toHaveLength(2);
  });
  it('clears old search marks and treats whitespace and case consistently', () => {
    const layer = document.createElement('div');
    layer.innerHTML = '<span data-reader-match="true">Some   TEXT</span><span>More</span>';
    expect(markSearchText(layer, 'some text')?.textContent).toBe('Some   TEXT');
    expect(markSearchText(layer, 'missing')).toBeNull();
    expect(layer.querySelectorAll('[data-reader-match=true]')).toHaveLength(0);
    expect(markSearchText(layer, '')).toBeNull();
  });
});
