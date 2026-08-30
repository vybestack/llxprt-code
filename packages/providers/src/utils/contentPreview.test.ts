import { describe, it, expect } from 'bun:test';
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

  it('summarizes media parts without previewing bytes, paths, or provider secrets', () => {
    const rawMedia = Buffer.from([1, 2, 3, 4]).toString('base64');
    const content = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: rawMedia,
        },
        filename: '/Users/private/project/image.png',
        providerMetadata: { credential: 'provider-secret-3199' },
      },
    ];

    const result = getContentPreview(content);

    expect(result).toContain('"byteCount":4');
    expect(result).toContain('"mimeType":"image/png"');
    expect(result).toContain('"transportMode":"full"');
    expect(result).not.toContain(rawMedia);
    expect(result).not.toContain('/Users/private');
    expect(result).not.toContain('provider-secret-3199');
  });

  it('sanitizes media before invoking JSON serialization hooks', () => {
    const rawMedia = Buffer.from([5, 6, 7, 8]).toString('base64');
    const media = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: rawMedia,
      },
      toJSON(): never {
        throw new Error('raw media was serialized');
      },
    };

    const result = getContentPreview({ media });

    expect(result).toContain('"byteCount":4');
    expect(result).toContain('"mimeType":"image/png"');
    expect(result).not.toContain(rawMedia);
  });

  it('serializes plain objects as JSON', () => {
    const result = getContentPreview({ key: 'value' });
    expect(result).toBe('{"key":"value"}');
  });

  it('handles circular content through the sanitized representation', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(getContentPreview(circular)).toBe('{"self":"[unserializable]"}');
  });
});
