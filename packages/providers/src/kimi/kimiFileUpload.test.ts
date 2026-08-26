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
 * See the License for the specific language.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import {
  uploadKimiFiles,
  buildKimiFileReferenceText,
  createBoundedCache,
} from './kimiFileUpload.js';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

type FileCreateBody = { file: unknown; purpose: string };

function createMockClient(
  fileCreateImpl?: (
    body: FileCreateBody,
  ) => Promise<{ id: string; bytes: number }>,
) {
  const defaultImpl = async (body: FileCreateBody) => {
    expect(body.purpose).toBe('file-extract');
    return {
      id: `file-${Math.random().toString(36).slice(2, 10)}`,
      bytes: 1024,
    };
  };
  const filesCreate = vi.fn(fileCreateImpl ?? defaultImpl);
  return {
    client: {
      apiKey: 'test-key',
      baseURL: 'https://api.kimi.com/coding/v1',
      files: { create: filesCreate },
    } as unknown as Parameters<typeof uploadKimiFiles>[0],
    filesCreate,
  };
}

function makePdfBlock(data: string, filename = 'doc.pdf'): MediaBlock {
  return {
    type: 'media',
    mimeType: 'application/pdf',
    data,
    encoding: 'base64',
    filename,
  };
}

function makeVideoBlock(data: string, filename = 'clip.mp4'): MediaBlock {
  return {
    type: 'media',
    mimeType: 'video/mp4',
    data,
    encoding: 'base64',
    filename,
  };
}

function failFirstUploadThenSucceed() {
  let callCount = 0;
  return async (): Promise<{ id: string; bytes: number }> => {
    callCount++;
    if (callCount === 1) {
      throw new Error('transient');
    }
    return { id: 'file-ok', bytes: 5 };
  };
}

describe('uploadKimiFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads each PDF block and returns file ids', async () => {
    const { client, filesCreate } = createMockClient(async () => ({
      id: 'file-abc',
      bytes: 42,
    }));
    const blocks = [
      makePdfBlock('AAAA', 'a.pdf'),
      makePdfBlock('BBBB', 'b.pdf'),
    ];

    const results = await uploadKimiFiles(client, blocks);

    expect(filesCreate).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[0].fileId).toBe('file-abc');
    expect(results[0].failed).toBe(false);
    expect(results[1].fileId).toBe('file-abc');
    expect(results[1].failed).toBe(false);
  });

  it('uses purpose file-extract for every upload', async () => {
    const { client, filesCreate } = createMockClient();
    await uploadKimiFiles(client, [makePdfBlock('AAAA')]);

    const body = filesCreate.mock.calls[0][0];
    expect(body.purpose).toBe('file-extract');
  });

  it('uploads videos with Moonshot video purpose when enabled', async () => {
    const { client, filesCreate } = createMockClient(async () => ({
      id: 'video-1',
      bytes: 20,
    }));

    const results = await uploadKimiFiles(
      client,
      [makeVideoBlock('AAAA')],
      undefined,
      { allowVideo: true },
    );

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(filesCreate.mock.calls[0][0].purpose).toBe('video');
    expect(results[0].fileId).toBe('video-1');
  });

  it('does not upload videos unless explicitly enabled', async () => {
    const { client, filesCreate } = createMockClient();

    const results = await uploadKimiFiles(client, [makeVideoBlock('AAAA')]);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(results[0].failed).toBe(true);
  });

  it('de-duplicates identical blocks via the cache', async () => {
    const { client, filesCreate } = createMockClient(async () => ({
      id: 'file-dedup',
      bytes: 10,
    }));
    const cache = createBoundedCache<string>(10);
    const block = makePdfBlock('SAMECONTENT', 'report.pdf');

    const first = await uploadKimiFiles(client, [block], cache);
    const second = await uploadKimiFiles(client, [block], cache);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(first[0].fileId).toBe('file-dedup');
    expect(second[0].fileId).toBe('file-dedup');
    expect(second[0].failed).toBe(false);
  });

  it('does not reuse file ids across API credentials', async () => {
    const first = createMockClient(async () => ({ id: 'file-a', bytes: 10 }));
    const second = createMockClient(async () => ({ id: 'file-b', bytes: 10 }));
    Object.assign(first.client, {
      baseURL: 'https://api.moonshot.ai/v1',
      apiKey: 'account-a',
    });
    Object.assign(second.client, {
      baseURL: 'https://api.moonshot.ai/v1',
      apiKey: 'account-b',
    });
    const cache = createBoundedCache<string>(10);
    const block = makePdfBlock('SAMECONTENT');

    const firstResult = await uploadKimiFiles(first.client, [block], cache);
    const secondResult = await uploadKimiFiles(second.client, [block], cache);

    expect(first.filesCreate).toHaveBeenCalledTimes(1);
    expect(second.filesCreate).toHaveBeenCalledTimes(1);
    expect(firstResult[0].fileId).toBe('file-a');
    expect(secondResult[0].fileId).toBe('file-b');
  });

  it('hashes the full payload rather than only matching prefix and suffix', async () => {
    let uploadCount = 0;
    const { client, filesCreate } = createMockClient(async () => ({
      id: `file-${++uploadCount}`,
      bytes: 10,
    }));
    const cache = createBoundedCache<string>(10);
    const prefix = 'A'.repeat(512);
    const suffix = 'Z'.repeat(512);

    await uploadKimiFiles(
      client,
      [makePdfBlock(`${prefix}MIDDLE-ONE${suffix}`)],
      cache,
    );
    await uploadKimiFiles(
      client,
      [makePdfBlock(`${prefix}MIDDLE-TWO${suffix}`)],
      cache,
    );

    expect(filesCreate).toHaveBeenCalledTimes(2);
  });

  it('marks blocks as failed when upload throws', async () => {
    const { client, filesCreate } = createMockClient(async () => {
      throw new Error('network error');
    });
    const block = makePdfBlock('AAAA');

    const results = await uploadKimiFiles(client, [block]);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(results[0].failed).toBe(true);
    expect(results[0].fileId).toBeUndefined();
  });

  it('continues uploading remaining blocks after a failure', async () => {
    const { client, filesCreate } = createMockClient(
      failFirstUploadThenSucceed(),
    );

    const results = await uploadKimiFiles(client, [
      makePdfBlock('FAIL'),
      makePdfBlock('OK'),
    ]);

    expect(filesCreate).toHaveBeenCalledTimes(2);
    expect(results[0].failed).toBe(true);
    expect(results[1].fileId).toBe('file-ok');
    expect(results[1].failed).toBe(false);
  });

  it('strips data URI prefix before decoding base64', async () => {
    const { client, filesCreate } = createMockClient(async (body) => {
      expect(body.purpose).toBe('file-extract');
      return { id: 'file-1', bytes: 4 };
    });
    const block: MediaBlock = {
      type: 'media',
      mimeType: 'application/pdf',
      data: 'data:application/pdf;base64,JVBERi0xLjQ=',
      encoding: 'base64',
      filename: 'report.pdf',
    };

    const results = await uploadKimiFiles(client, [block]);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(results[0].fileId).toBe('file-1');
    expect(results[0].failed).toBe(false);

    // Verify the data URI prefix was stripped — the uploaded File should
    // contain only the decoded raw bytes (JVBERi0xLjQ= = "%PDF-1.4").
    const uploadedFile = filesCreate.mock.calls[0][0].file as File;
    const arrayBuffer = await uploadedFile.arrayBuffer();
    expect(Buffer.from(arrayBuffer).toString('utf8')).toBe('%PDF-1.4');
  });

  it('preserves input order for uploadable and unsupported blocks', async () => {
    const { client, filesCreate } = createMockClient(async () => ({
      id: 'file-pdf',
      bytes: 10,
    }));
    const pdf = makePdfBlock('PDFDATA', 'first.pdf');
    const video = makeVideoBlock('VIDEODATA', 'second.mp4');

    const results = await uploadKimiFiles(client, [pdf, video]);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.block)).toStrictEqual([pdf, video]);
    expect(results[0].failed).toBe(false);
    expect(results[1].failed).toBe(true);
  });

  it('marks URL media failed without uploading it', async () => {
    const { client, filesCreate } = createMockClient();
    const urlBlock: MediaBlock = {
      type: 'media',
      mimeType: 'application/pdf',
      data: 'https://example.com/document.pdf',
      encoding: 'url',
      filename: 'remote.pdf',
    };

    const results = await uploadKimiFiles(client, [urlBlock]);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(results).toStrictEqual([{ block: urlBlock, failed: true }]);
  });

  it('returns empty array for empty input', async () => {
    const { client, filesCreate } = createMockClient();
    const results = await uploadKimiFiles(client, []);
    expect(results).toStrictEqual([]);
    expect(filesCreate).not.toHaveBeenCalled();
  });
});

describe('buildKimiFileReferenceText', () => {
  it('returns empty string for no file ids', () => {
    expect(buildKimiFileReferenceText([])).toBe('');
  });

  it('builds reference text with single file id', () => {
    const text = buildKimiFileReferenceText(['file-abc']);
    expect(text).toContain('file-abc');
    expect(text).toContain('Uploaded files available for reference');
  });

  it('lists all file ids', () => {
    const text = buildKimiFileReferenceText(['file-1', 'file-2']);
    expect(text).toContain('- file-1');
    expect(text).toContain('- file-2');
  });
});

describe('createBoundedCache', () => {
  it('rejects non-positive and non-integer capacities', () => {
    expect(() => createBoundedCache<string>(0)).toThrow(RangeError);
    expect(() => createBoundedCache<string>(-1)).toThrow(RangeError);
    expect(() => createBoundedCache<string>(1.5)).toThrow(RangeError);
  });

  it('evicts oldest entry when maxSize is exceeded', () => {
    const cache = createBoundedCache<string>(2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('evicts the least recently used entry', () => {
    const cache = createBoundedCache<string>(2);
    cache.set('a', '1');
    cache.set('b', '2');

    expect(cache.get('a')).toBe('1');
    cache.set('c', '3');

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('supports get/set/has/delete', () => {
    const cache = createBoundedCache<string>(10);
    cache.set('x', 'val');
    expect(cache.get('x')).toBe('val');
    expect(cache.has('x')).toBe(true);
    expect(cache.delete('x')).toBe(true);
    expect(cache.has('x')).toBe(false);
  });
});

describe('CodeQL js/insufficient-password-hash: HMAC-derived cache key namespacing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function clientWith(
    apiKey: string,
    baseURL = 'https://api.moonshot.ai/v1',
  ): Parameters<typeof uploadKimiFiles>[0] {
    const filesCreate = vi.fn(async () => ({
      id: `file-${Math.random().toString(36).slice(2, 10)}`,
      bytes: 10,
    }));
    return {
      apiKey,
      baseURL,
      files: { create: filesCreate },
    } as unknown as Parameters<typeof uploadKimiFiles>[0];
  }

  it('distinct api keys yield distinct cache keys (no cross-account aliasing)', async () => {
    const cache = createBoundedCache<string>(10);
    const block = makePdfBlock('SAMECONTENT', 'report.pdf');

    await uploadKimiFiles(clientWith('account-a'), [block], cache);
    await uploadKimiFiles(clientWith('account-b'), [block], cache);

    // Two uploads means the cache keys differed by credential, so the second
    // was not served from the first's cache entry.
    expect(cache.size).toBe(2);
  });

  it('identical inputs yield a stable key (dedup across turns)', async () => {
    const cache = createBoundedCache<string>(10);
    const block = makePdfBlock('SAMECONTENT', 'report.pdf');

    const first = await uploadKimiFiles(
      clientWith('account-a'),
      [block],
      cache,
    );
    const second = await uploadKimiFiles(
      clientWith('account-a'),
      [block],
      cache,
    );

    // Stable key => second turn reuses the cached file id (only one upload).
    expect(first[0].fileId).toBe(second[0].fileId);
    expect(first[0].fileId).not.toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it('distinct file payloads never collide even with the same credential', async () => {
    const cache = createBoundedCache<string>(10);

    await uploadKimiFiles(
      clientWith('account-a'),
      [makePdfBlock('PAYLOAD-ONE', 'a.pdf')],
      cache,
    );
    await uploadKimiFiles(
      clientWith('account-a'),
      [makePdfBlock('PAYLOAD-TWO', 'b.pdf')],
      cache,
    );

    // Different content => different cache key => two distinct entries.
    expect(cache.size).toBe(2);
  });

  it('a single-character change in the payload produces a distinct cache key', async () => {
    const cache = createBoundedCache<string>(10);

    await uploadKimiFiles(
      clientWith('account-a'),
      [makePdfBlock('PAYLOAD-X', 'a.pdf')],
      cache,
    );
    await uploadKimiFiles(
      clientWith('account-a'),
      [makePdfBlock('PAYLOAD-Y', 'a.pdf')],
      cache,
    );

    expect(cache.size).toBe(2);
  });
});
