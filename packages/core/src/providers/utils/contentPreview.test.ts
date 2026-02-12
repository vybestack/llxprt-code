import { describe, it, expect } from 'vitest';
import { getContentPreview } from './contentPreview.js';

describe('getContentPreview', () => {
  it('returns undefined for null or undefined', () => {
    expect(getContentPreview(null)).toBeUndefined();
    expect(getContentPreview(undefined)).toBeUndefined();
  });

  it('returns short strings as-is', () => {
    expect(getContentPreview('hello')).toBe('hello');
  });

  it('truncates long strings with ellipsis', () => {
    const long = 'a'.repeat(300);
    const result = getContentPreview(long);
    expect(result?.length).toBeLessThan(210);
    expect(result).toContain('…');
  });

  it('respects custom maxLength', () => {
    const result = getContentPreview('abcdefgh', 5);
    expect(result).toBe('abcde…');
  });

  it('handles arrays of text parts', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(getContentPreview(content)).toBe('hello\nworld');
  });

  it('serializes non-text array parts as JSON', () => {
    const content = [{ type: 'image', url: 'http://example.com' }];
    const result = getContentPreview(content);
    expect(result).toContain('image');
    expect(result).toContain('example.com');
  });

  it('serializes plain objects as JSON', () => {
    const result = getContentPreview({ key: 'value' });
    expect(result).toBe('{"key":"value"}');
  });

  it('handles unserializable content gracefully', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(getContentPreview(circular)).toBe('[unserializable content]');
  });
});
