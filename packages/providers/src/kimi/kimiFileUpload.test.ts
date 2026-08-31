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

import { assertInstanceOf, errorMessage } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import {
  uploadKimiFiles,
  buildKimiFileReferenceText,
  createBoundedCache,
} from './kimiFileUpload.js';
import type {
  InlineMediaBlock,
  MediaBlock,
  ProviderFileReferenceMetadata,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  ProviderFileLifecycle,
  resolveProviderFilePolicy,
} from '../providerFilePolicy.js';

type FileCreateBody = { file: unknown; purpose: string };

function createMockClient(
  fileCreateImpl?: (
    body: FileCreateBody,
  ) => Promise<{ id: string; bytes: number }>,
  fileDeleteImpl: (fileId: string) => Promise<{
    id: string;
    object: 'file';
    deleted: boolean;
  }> = async (fileId) => ({ id: fileId, object: 'file', deleted: true }),
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
      files: {
        create: filesCreate,
        delete: fileDeleteImpl,
      },
    } as unknown as Parameters<typeof uploadKimiFiles>[0],
    filesCreate,
  };
}

function makePdfBlock(data: string, filename = 'doc.pdf'): InlineMediaBlock {
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

const KIMI_TEST_IDENTITY = {
  provider: 'kimi',
  baseURL: 'https://api.kimi.com/coding/v1',
  credentialHash: 'credential-a',
};

function sessionPolicy(deletion: 'retain' | 'delete' = 'delete') {
  return resolveProviderFilePolicy({
    configuredMode: 'session',
    configuredRetentionMs: 60_000,
    configuredDeletion: deletion,
    providerFileReferences: true,
    zeroDataRetention: 'incompatible-while-retained',
    zeroDataRetentionRequired: false,
  });
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

  it('rejects the request when an attempted upload fails', async () => {
    const { client } = createMockClient(async () => {
      throw new Error('network error');
    });

    await expect(
      uploadKimiFiles(client, [makePdfBlock('AAAA')]),
    ).rejects.toThrow(
      'Kimi file upload failed for doc.pdf (application/pdf): network error',
    );
  });

  it('rejects a multi-file request when one upload fails', async () => {
    let callCount = 0;
    const { client } = createMockClient(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('transient');
      }
      return { id: 'file-ok', bytes: 5 };
    });

    await expect(
      uploadKimiFiles(client, [makePdfBlock('FAIL'), makePdfBlock('OK')]),
    ).rejects.toThrow(
      'Kimi file upload failed for doc.pdf (application/pdf): transient',
    );
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

  it('persists stable references and holds their lease for request cleanup', async () => {
    const { client } = createMockClient(async () => ({
      id: 'file-lifecycle',
      bytes: 4,
    }));
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 2,
      maxBytes: 20,
      now: () => 1_000,
    });
    const policy = resolveProviderFilePolicy({
      configuredMode: 'session',
      configuredRetentionMs: 60_000,
      configuredDeletion: 'delete',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    });
    const leases: Array<{ release(): void }> = [];
    const persisted: ProviderFileReferenceMetadata[] = [];
    const block: MediaBlock = {
      ...makePdfBlock('AAAA'),
      sourceContentId:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };

    const first = await uploadKimiFiles(client, [block], undefined, {
      allowFileUpload: true,
      lifecycle,
      policy,
      identity: {
        provider: 'kimi',
        baseURL: 'https://api.kimi.com/coding/v1',
        credentialHash: 'credential-a',
      },
      scopeId: 'session-a',
      registerLease: (lease) => {
        leases.push(lease);
      },
      persistReference: async (_contentId, reference) => {
        persisted.push(reference);
      },
    });

    expect(first[0].fileId).toBe('file-lifecycle');
    expect(persisted[0]?.fileId).toBe('file-lifecycle');
    expect(lifecycle.snapshot().activeLeases).toBe(1);

    const restoredLifecycle = new ProviderFileLifecycle({
      maxFiles: 2,
      maxBytes: 20,
      now: () => 2_000,
    });
    const restoredBlock: MediaBlock = {
      ...block,
      providerFiles: persisted,
    };
    const restoredLeases: Array<{ release(): void }> = [];
    const restored = await uploadKimiFiles(client, [restoredBlock], undefined, {
      allowFileUpload: true,
      lifecycle: restoredLifecycle,
      policy,
      identity: {
        provider: 'kimi',
        baseURL: 'https://api.kimi.com/coding/v1',
        credentialHash: 'credential-a',
      },
      scopeId: 'session-a',
      registerLease: (lease) => {
        restoredLeases.push(lease);
      },
    });

    expect(restored[0].fileId).toBe('file-lifecycle');
    expect(restoredLifecycle.snapshot().activeLeases).toBe(1);
    await Promise.all(leases.map((lease) => lease.release()));
    await Promise.all(restoredLeases.map((lease) => lease.release()));
    expect(lifecycle.snapshot().activeLeases).toBe(0);
    expect(restoredLifecycle.snapshot().activeLeases).toBe(0);
  });

  it('releases an acquired lease when request cleanup registration throws', async () => {
    const { client } = createMockClient(async () => ({
      id: 'file-registration',
      bytes: 4,
    }));
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const block = makePdfBlock('AAAA');
    const options = {
      allowFileUpload: true,
      lifecycle,
      policy: sessionPolicy(),
      identity: KIMI_TEST_IDENTITY,
      scopeId: 'session-a',
    };
    await uploadKimiFiles(client, [block], undefined, options);

    const reuse = uploadKimiFiles(client, [block], undefined, {
      ...options,
      registerLease: () => {
        throw new Error('cleanup registration unavailable');
      },
    });

    await expect(reuse).rejects.toThrow('cleanup registration unavailable');
    expect(lifecycle.snapshot().activeLeases).toBe(0);
  });

  it('preserves registration and deferred deletion failures while releasing an acquired lease', async () => {
    const { client } = createMockClient(
      async () => ({ id: 'file-registration-cleanup', bytes: 4 }),
      async () => {
        throw new Error('remote deletion unavailable');
      },
    );
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const block = makePdfBlock('AAAA');
    const options = {
      allowFileUpload: true,
      lifecycle,
      policy: sessionPolicy(),
      identity: KIMI_TEST_IDENTITY,
      scopeId: 'session-a',
    };
    await uploadKimiFiles(client, [block], undefined, options);
    let cleanup: Promise<unknown> | undefined;

    const error = await uploadKimiFiles(client, [block], undefined, {
      ...options,
      registerLease: () => {
        cleanup = lifecycle.cleanupScope('session', 'session-a');
        throw new Error('cleanup registration unavailable');
      },
    }).catch((reason: unknown) => reason);
    await cleanup;

    assertInstanceOf(
      error,
      AggregateError,
      'Expected registration and deletion AggregateError',
    );
    const messages = error.errors.map((failure: unknown) =>
      errorMessage(failure),
    );
    expect(messages).toContain('cleanup registration unavailable');
    expect(
      messages.some((message) =>
        message.includes('remote deletion unavailable'),
      ),
    ).toBe(true);
    expect(lifecycle.snapshot().activeLeases).toBe(0);
    expect(lifecycle.snapshot().deletionFailures).toHaveLength(1);
  });

  it('does not reuse a persisted provider file after the media bytes change', async () => {
    let uploadCount = 0;
    const { client, filesCreate } = createMockClient(async () => {
      uploadCount += 1;
      return { id: `file-content-${uploadCount}`, bytes: 4 };
    });
    const persisted: ProviderFileReferenceMetadata[] = [];
    const original: InlineMediaBlock = {
      ...makePdfBlock('AAAA'),
      sourceContentId:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    const policy = sessionPolicy();
    await uploadKimiFiles(client, [original], undefined, {
      allowFileUpload: true,
      lifecycle: new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 }),
      policy,
      identity: KIMI_TEST_IDENTITY,
      scopeId: 'session-a',
      persistReference: async (_contentId, reference) => {
        persisted.push(reference);
      },
    });
    const changed: InlineMediaBlock = {
      ...makePdfBlock('BBBB'),
      sourceContentId:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      providerFiles: persisted,
    };

    const result = await uploadKimiFiles(client, [changed], undefined, {
      allowFileUpload: true,
      lifecycle: new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 }),
      policy,
      identity: KIMI_TEST_IDENTITY,
      scopeId: 'session-a',
    });

    expect(result[0].fileId).toBe('file-content-2');
    expect(filesCreate).toHaveBeenCalledTimes(2);
  });

  it('propagates binding failure after upload and rolls back retained state', async () => {
    const deleted: string[] = [];
    const { client } = createMockClient(
      async () => ({ id: 'file-binding-failure', bytes: 4 }),
      async (fileId) => {
        deleted.push(fileId);
        return { id: fileId, object: 'file', deleted: true };
      },
    );
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const block: MediaBlock = {
      ...makePdfBlock('AAAA'),
      sourceContentId:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };

    const upload = uploadKimiFiles(client, [block], undefined, {
      allowFileUpload: true,
      lifecycle,
      policy: sessionPolicy('retain'),
      identity: KIMI_TEST_IDENTITY,
      scopeId: 'session-a',
      persistReference: async () => {
        throw new Error('binding unavailable');
      },
    });

    await expect(upload).rejects.toThrow('binding unavailable');
    expect(deleted).toStrictEqual(['file-binding-failure']);
    expect(lifecycle.snapshot().retainedFiles).toBe(0);
    expect(lifecycle.snapshot().activeLeases).toBe(0);
  });

  it('propagates lifecycle capacity failure after upload and rolls back remotely', async () => {
    const deleted: string[] = [];
    const { client } = createMockClient(
      async () => ({ id: 'file-over-capacity', bytes: 4 }),
      async (fileId) => {
        deleted.push(fileId);
        return { id: fileId, object: 'file', deleted: true };
      },
    );
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 0, maxBytes: 0 });

    const upload = uploadKimiFiles(client, [makePdfBlock('AAAA')], undefined, {
      allowFileUpload: true,
      lifecycle,
      policy: sessionPolicy(),
      identity: KIMI_TEST_IDENTITY,
      scopeId: 'session-a',
    });

    await expect(upload).rejects.toThrow('exceeds 0 files');
    expect(deleted).toStrictEqual(['file-over-capacity']);
    expect(lifecycle.snapshot().retainedFiles).toBe(0);
  });

  it('propagates rollback deletion failure without changing transport', async () => {
    const { client } = createMockClient(
      async () => ({ id: 'file-orphaned', bytes: 4 }),
      async () => {
        throw new Error('delete unavailable');
      },
    );
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 0, maxBytes: 0 });

    const error = await uploadKimiFiles(
      client,
      [makePdfBlock('AAAA')],
      undefined,
      {
        allowFileUpload: true,
        lifecycle,
        policy: sessionPolicy(),
        identity: KIMI_TEST_IDENTITY,
        scopeId: 'session-a',
      },
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toHaveProperty(
      'message',
      'Kimi provider file retention and rollback deletion failed',
    );
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
