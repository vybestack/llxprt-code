import { describe, it, expect } from 'vitest';
import { extractThinkTagsAsBlock } from './thinkingExtraction.js';

describe('extractThinkTagsAsBlock', () => {
  it('returns null for empty input', () => {
    expect(extractThinkTagsAsBlock('')).toBeNull();
    expect(extractThinkTagsAsBlock(null as unknown as string)).toBeNull();
    expect(extractThinkTagsAsBlock(undefined as unknown as string)).toBeNull();
  });

  it('returns null when no thinking tags found', () => {
    expect(extractThinkTagsAsBlock('Hello world')).toBeNull();
    expect(extractThinkTagsAsBlock('No tags here <b>bold</b>')).toBeNull();
  });

  it('extracts content from <think> tags', () => {
    const result = extractThinkTagsAsBlock('<think>reasoning here</think>');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('thinking');
    expect(result?.thought).toBe('reasoning here');
    expect(result?.sourceField).toBe('think_tags');
    expect(result?.isHidden).toBe(false);
  });

  it('extracts content from <thinking> tags', () => {
    const result = extractThinkTagsAsBlock('<thinking>deep thought</thinking>');
    expect(result?.thought).toBe('deep thought');
  });

  it('extracts content from <analysis> tags', () => {
    const result = extractThinkTagsAsBlock(
      '<analysis>analyzing the problem</analysis>',
    );
    expect(result?.thought).toBe('analyzing the problem');
  });

  it('combines multiple tag types with double newlines', () => {
    const result = extractThinkTagsAsBlock(
      '<think>first thought</think> text <thinking>second thought</thinking>',
    );
    expect(result?.thought).toBe('first thought\n\nsecond thought');
  });

  it('skips empty tag content', () => {
    const result = extractThinkTagsAsBlock(
      '<think></think><think>real thought</think>',
    );
    expect(result?.thought).toBe('real thought');
  });

  it('detects fragmented format and joins with spaces', () => {
    const parts = Array.from(
      { length: 10 },
      (_, i) => `<think>word${i}</think>`,
    ).join('');
    const result = extractThinkTagsAsBlock(parts);
    expect(result?.thought).toContain('word0 word1');
  });

  it('preserves internal newlines in standard format', () => {
    const result = extractThinkTagsAsBlock(
      '<think>line1\nline2\nline3</think>',
    );
    expect(result?.thought).toBe('line1\nline2\nline3');
  });

  it('is case-insensitive', () => {
    const result = extractThinkTagsAsBlock('<THINK>upper case</THINK>');
    expect(result?.thought).toBe('upper case');
  });
});
