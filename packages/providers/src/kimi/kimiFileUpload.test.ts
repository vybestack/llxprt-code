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

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    client: { files: { create: filesCreate } } as unknown as Parameters<
      typeof uploadKimiFiles
    >[0],
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
    let callCount = 0;
    const { client, filesCreate } = createMockClient(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('transient');
      }
      return { id: 'file-ok', bytes: 5 };
    });

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

  it('supports get/set/has/delete', () => {
    const cache = createBoundedCache<string>(10);
    cache.set('x', 'val');
    expect(cache.get('x')).toBe('val');
    expect(cache.has('x')).toBe(true);
    expect(cache.delete('x')).toBe(true);
    expect(cache.has('x')).toBe(false);
  });
});
