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
} from './mediaUtils.js';
import type { MediaBlock } from '../../services/history/IContent.js';

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
