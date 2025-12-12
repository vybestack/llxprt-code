import { describe, expect, it } from 'vitest';
import { filterItems, type SearchItem } from './types';

const SAMPLE_ITEMS: SearchItem[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'g', label: 'Gamma' },
];

describe('filterItems', () => {
  it('filters by substring', () => {
    const result = filterItems(SAMPLE_ITEMS, 'al');
    expect(result.map((item) => item.id)).toStrictEqual(['a']);
  });

  it('sorts alphabetically when requested', () => {
    const result = filterItems(SAMPLE_ITEMS, '', true);
    expect(result.map((item) => item.id)).toStrictEqual(['a', 'b', 'g']);
  });

  it('preserves order when not sorting', () => {
    const reversed = [...SAMPLE_ITEMS].reverse();
    const result = filterItems(reversed, '');
    expect(result.map((item) => item.id)).toStrictEqual(['g', 'b', 'a']);
  });
});
