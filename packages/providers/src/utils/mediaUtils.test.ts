/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeMediaToDataUri,
  classifyMediaBlock,
  buildUnsupportedMediaPlaceholder,
  detectImageMimeTypeFromBase64,
} from './mediaUtils.js';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('normalizeMediaToDataUri', () => {
  it('returns data URI unchanged when media.data already starts with "data:"', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'image/png',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      encoding: 'base64',
    };

    const result = normalizeMediaToDataUri(media);

    expect(result).toBe(media.data);
  });

  it('returns URL unchanged when encoding is "url"', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'image/png',
      data: 'https://example.com/image.png',
      encoding: 'url',
    };

    const result = normalizeMediaToDataUri(media);

    expect(result).toBe('https://example.com/image.png');
  });

  it('constructs data URI with mimeType when encoding is base64 and mimeType is present', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'image/jpeg',
      data: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
      encoding: 'base64',
    };

    const result = normalizeMediaToDataUri(media);

    expect(result).toBe(
      `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=`,
    );
  });

  it('constructs data URI with fallback mimeType when encoding is base64 and mimeType is missing', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: '',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      encoding: 'base64',
    };

    const result = normalizeMediaToDataUri(media);

    expect(result).toBe(
      'data:image/*;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
  });

  it('handles PDF media type correctly', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'application/pdf',
      data: 'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDMgM10+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMTAgMDAwMDAgbgowMDAwMDAwMDUzIDAwMDAwIG4KMDAwMDAwMDEwMiAwMDAwMCBuCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTQ5CiUlRU9G',
      encoding: 'base64',
    };

    const result = normalizeMediaToDataUri(media);

    expect(result).toBe(
      'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDMgM10+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMTAgMDAwMDAgbgowMDAwMDAwMDUzIDAwMDAwIG4KMDAwMDAwMDEwMiAwMDAwMCBuCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTQ5CiUlRU9G',
    );
  });
});

describe('classifyMediaBlock', () => {
  it('classifies image MIME types', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'image/png',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('image');
  });

  it('classifies image/jpeg', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'image/jpeg',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('image');
  });

  it('classifies application/pdf as pdf', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'application/pdf',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('pdf');
  });

  it('classifies audio MIME types', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'audio/mpeg',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('audio');
  });

  it('classifies video MIME types', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'video/mp4',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('video');
  });

  it('returns unknown for unrecognized MIME types', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'application/json',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('unknown');
  });

  it('returns unknown for empty mimeType', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: '',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('unknown');
  });

  it('handles mixed-case image MIME types', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'Image/PNG',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('image');
  });

  it('handles uppercase MIME types', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'APPLICATION/PDF',
      data: 'abc',
      encoding: 'base64',
    };
    expect(classifyMediaBlock(media)).toBe('pdf');
  });
});

describe('buildUnsupportedMediaPlaceholder', () => {
  it('produces placeholder with filename', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'audio/mpeg',
      data: 'abc',
      encoding: 'base64',
      filename: 'song.mp3',
    };
    const result = buildUnsupportedMediaPlaceholder(media, 'OpenAI');
    expect(result).toContain('audio/mpeg');
    expect(result).toContain('(song.mp3)');
    expect(result).toContain('OpenAI');
    expect(result).toContain('audio');
  });

  it('produces placeholder without filename', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'video/mp4',
      data: 'abc',
      encoding: 'base64',
    };
    const result = buildUnsupportedMediaPlaceholder(media, 'Anthropic');
    expect(result).toContain('video/mp4');
    expect(result).not.toContain('(');
    expect(result).toContain('Anthropic');
  });

  it('uses PDF label for application/pdf', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'application/pdf',
      data: 'abc',
      encoding: 'base64',
      filename: 'doc.pdf',
    };
    const result = buildUnsupportedMediaPlaceholder(media, 'OpenAI Vercel');
    expect(result).toContain('PDF');
    expect(result).toContain('OpenAI Vercel');
  });

  it('uses media label for unknown MIME types', () => {
    const media: MediaBlock = {
      type: 'media',
      mimeType: 'application/octet-stream',
      data: 'abc',
      encoding: 'base64',
    };
    const result = buildUnsupportedMediaPlaceholder(media, 'Test');
    expect(result).toContain('media');
    expect(result).toContain('application/octet-stream');
  });
});

describe('detectImageMimeTypeFromBase64', () => {
  it('returns image/png for PNG magic bytes', () => {
    const pngBase64 = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]).toString('base64');
    expect(detectImageMimeTypeFromBase64(pngBase64)).toBe('image/png');
  });

  it('returns image/jpeg for JPEG magic bytes', () => {
    const jpegBase64 = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]).toString('base64');
    expect(detectImageMimeTypeFromBase64(jpegBase64)).toBe('image/jpeg');
  });

  it('returns image/gif for GIF magic bytes', () => {
    const gifBase64 = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
    ]).toString('base64');
    expect(detectImageMimeTypeFromBase64(gifBase64)).toBe('image/gif');
  });

  it('returns image/webp for WEBP magic bytes (RIFF....WEBP)', () => {
    const webpBase64 = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]).toString('base64');
    expect(detectImageMimeTypeFromBase64(webpBase64)).toBe('image/webp');
  });

  it('returns null for non-image data (PDF magic bytes)', () => {
    const pdfBase64 = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
    ]).toString('base64');
    expect(detectImageMimeTypeFromBase64(pdfBase64)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(detectImageMimeTypeFromBase64('')).toBe(null);
  });

  it('returns null for whitespace-only input', () => {
    expect(detectImageMimeTypeFromBase64('    ')).toBe(null);
  });

  it('returns null for plain text data', () => {
    const textBase64 = Buffer.from('hello world', 'utf-8').toString('base64');
    expect(detectImageMimeTypeFromBase64(textBase64)).toBe(null);
  });

  it('detects format correctly even with many trailing bytes (PNG)', () => {
    const longBuffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(512, 0xab),
    ]);
    const longBase64 = longBuffer.toString('base64');
    expect(detectImageMimeTypeFromBase64(longBase64)).toBe('image/png');
  });

  it('detects format correctly even with many trailing bytes (JPEG)', () => {
    const longBuffer = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(512, 0xcd),
    ]);
    const longBase64 = longBuffer.toString('base64');
    expect(detectImageMimeTypeFromBase64(longBase64)).toBe('image/jpeg');
  });

  it('detects wrapped/whitespace base64 by ignoring whitespace before decoding (WEBP)', () => {
    const webpBuffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    const webpBase64 = webpBuffer.toString('base64');
    const wrapped = `
  ${webpBase64.slice(0, 8)}
${webpBase64.slice(8)}
`;
    expect(detectImageMimeTypeFromBase64(wrapped)).toBe('image/webp');
  });

  it('corrects mismatched declared MIME: declared JPEG but actual PNG bytes detects as image/png (issue #2130)', () => {
    const pngBytesDeclaredAsJpeg = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]).toString('base64');
    expect(detectImageMimeTypeFromBase64(pngBytesDeclaredAsJpeg)).toBe(
      'image/png',
    );
  });

  it('returns null when malformed base64 does not decode to known image bytes', () => {
    expect(detectImageMimeTypeFromBase64('!!!not-valid-base64-!@#$')).toBe(
      null,
    );
  });
});
