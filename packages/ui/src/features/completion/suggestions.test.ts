import { describe, expect, it } from 'vitest';
import {
  extractMentionQuery,
  findMentionRange,
  getSuggestions,
} from './suggestions';

describe('getSuggestions', () => {
  it('returns matches starting with query first', () => {
    const results = getSuggestions('A');
    expect(results[0]).toBe('Abacadbras.tsx');
  });

  it('prioritizes files over directories for shared prefix', () => {
    const results = getSuggestions('p');
    expect(results[0]).toBe('package.json');
    expect(results[1]).toBe('packages/');
  });

  it('returns exact subpath matches', () => {
    const results = getSuggestions('src');
    expect(results[0]).toBe('packages/src');
  });

  it('returns empty when no matches', () => {
    expect(getSuggestions('b')).toHaveLength(0);
  });
});

describe('extractMentionQuery', () => {
  it('extracts query after @ before cursor', () => {
    expect(extractMentionQuery('hello @pac', 10)).toBe('pac');
  });

  it('returns null when no @', () => {
    expect(extractMentionQuery('hello world', 5)).toBeNull();
  });

  it('ignores @ inside words', () => {
    expect(extractMentionQuery('hello@pac', 9)).toBeNull();
  });

  it('finds mention range for replacement', () => {
    const range = findMentionRange('test @pa th', 8);
    expect(range).toStrictEqual({ start: 5, end: 8 });
  });

  it('returns null range when none', () => {
    expect(findMentionRange('test', 2)).toBeNull();
  });
});
