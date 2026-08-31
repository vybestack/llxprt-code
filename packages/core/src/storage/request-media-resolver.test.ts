/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  chmod,
  mkdtemp,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { LocalMediaStore } from './local-media-store.js';
import {
  RequestMediaResolutionError,
  RequestMediaResolver,
} from './request-media-resolver.js';

function useTempDirectory(): () => string {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-request-media-'));
  });
  afterEach(async () => {
    if (directory !== '') {
      await chmod(directory, 0o700).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
  return () => directory;
}

function content(
  turnId: string,
  blocks: IContent['blocks'],
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks, metadata: { turnId } };
}

async function objectPath(
  root: string,
  reference: MediaReferenceBlock,
): Promise<string> {
  const digest = reference.contentId.slice('sha256:'.length);
  const directory = join(root, 'objects', 'sha256');
  const entries = await readdir(directory);
  const match = entries.find((entry) => entry === digest);
  if (match === undefined) {
    throw new Error(`Object ${reference.contentId} was not stored`);
  }
  return join(directory, match);
}

async function admittedReference(
  store: LocalMediaStore,
  bytes: Uint8Array,
): Promise<MediaReferenceBlock> {
  return store.admit({
    bytes,
    mimeType: 'image/png',
    dimensions: { width: 7, height: 5 },
    semanticMetadata: { detail: 'high', source: 'tool' },
    providerFileIds: { kimi: 'file_123' },
  });
}

async function capturedError(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('Expected an Error instance');
  }
  throw new Error('Expected operation to reject');
}

class FailOnceReleaseStore extends LocalMediaStore {
  private releaseFailurePending = true;

  override async release(contentId: string, ownerId: string): Promise<void> {
    if (this.releaseFailurePending) {
      this.releaseFailurePending = false;
      throw new Error('induced release failure');
    }
    await super.release(contentId, ownerId);
  }
}

describe('request-media-resolver', () => {
  describe('RequestMediaResolver', () => {
    const tempDirectory = useTempDirectory();

    function store(quotaBytes = 1024): LocalMediaStore {
      return new LocalMediaStore({
        rootDirectory: tempDirectory(),
        quotaBytes,
      });
    }

    it('materializes selected references without changing block or message order', async () => {
      const mediaStore = store();
      const reference = await admittedReference(
        mediaStore,
        new Uint8Array([0, 1, 2, 253, 254, 255]),
      );
      const selected = [
        content('turn-before', [{ type: 'text', text: 'before' }]),
        content('turn-image', [
          { type: 'text', text: 'caption prefix' },
          {
            ...reference,
            caption: 'chart',
            filename: 'chart.png',
            providerMetadata: { detail: 'high' },
          },
          { type: 'text', text: 'caption suffix' },
        ]),
      ];
      const resolver = new RequestMediaResolver(mediaStore);

      const resolved = await resolver.resolve({
        contents: selected,
        requestId: 'request-1',
        turnId: 'active-turn',
        aggregateBudgetBytes: reference.normalizedBase64Length,
      });

      expect(resolved.withContents((contents) => contents)).toStrictEqual([
        selected[0],
        content('turn-image', [
          { type: 'text', text: 'caption prefix' },
          {
            type: 'media',
            encoding: 'base64',
            data: 'AAEC/f7/',
            mimeType: 'image/png',
            caption: 'chart',
            filename: 'chart.png',
            providerMetadata: { detail: 'high' },
            dimensions: { width: 7, height: 5 },
            semanticMetadata: { detail: 'high', source: 'tool' },
            providerFileIds: { kimi: 'file_123' },
          },
          { type: 'text', text: 'caption suffix' },
        ]),
      ]);
      expect(resolved.accounting()).toStrictEqual({
        selectedReferenceCount: 1,
        uniqueContentCount: 1,
        selectedNormalizedBytes: 8,
        materializedNormalizedBytes: 8,
        storeReadCount: 1,
        reservedContentCount: 1,
        released: false,
      });
      expect(await mediaStore.hasReservations(reference.contentId)).toBe(true);
      const reachableContents = resolved.withContents((contents) => contents);
      const providerEnvelope = resolved.withContents((contents) => ({
        messages: [...contents],
      }));
      resolved.registerCleanup(() => {
        providerEnvelope.messages.splice(0);
      });

      await resolved.release();
      await resolved.release();

      expect(await mediaStore.hasReservations(reference.contentId)).toBe(false);
      expect(reachableContents).toStrictEqual([]);
      expect(providerEnvelope.messages).toStrictEqual([]);
      expect(() => resolved.withContents((contents) => contents)).toThrow(
        /after release/i,
      );
      expect(resolved.accounting()).toStrictEqual({
        selectedReferenceCount: 1,
        uniqueContentCount: 1,
        selectedNormalizedBytes: 8,
        materializedNormalizedBytes: 0,
        storeReadCount: 1,
        reservedContentCount: 0,
        released: true,
      });
    });

    it('reads and materializes duplicate content once while preserving duplicate blocks', async () => {
      const mediaStore = store();
      const reference = await admittedReference(
        mediaStore,
        new Uint8Array([1, 2, 3]),
      );
      const resolver = new RequestMediaResolver(mediaStore);

      const resolved = await resolver.resolve({
        contents: [content('turn-duplicate', [reference, reference])],
        requestId: 'request-duplicate',
        turnId: 'active-turn',
        aggregateBudgetBytes: 8,
      });

      expect(
        resolved.withContents((contents) => contents)[0]?.blocks,
      ).toStrictEqual([
        {
          type: 'media',
          encoding: 'base64',
          data: 'AQID',
          mimeType: 'image/png',
          dimensions: { width: 7, height: 5 },
          semanticMetadata: { detail: 'high', source: 'tool' },
          providerFileIds: { kimi: 'file_123' },
        },
        {
          type: 'media',
          encoding: 'base64',
          data: 'AQID',
          mimeType: 'image/png',
          dimensions: { width: 7, height: 5 },
          semanticMetadata: { detail: 'high', source: 'tool' },
          providerFileIds: { kimi: 'file_123' },
        },
      ]);
      expect(resolved.accounting()).toStrictEqual({
        selectedReferenceCount: 2,
        uniqueContentCount: 1,
        selectedNormalizedBytes: 8,
        materializedNormalizedBytes: 4,
        storeReadCount: 1,
        reservedContentCount: 1,
        released: false,
      });
      await resolved.release();
    });

    it.each([
      ['zero', 0],
      ['one byte under', 3],
    ])(
      'rejects a %s aggregate limit before reads or reservations',
      async (_label, limit) => {
        const mediaStore = store();
        const reference = await admittedReference(
          mediaStore,
          new Uint8Array([1, 2, 3]),
        );
        const resolver = new RequestMediaResolver(mediaStore);

        const error = await capturedError(
          resolver.resolve({
            contents: [content('budget-turn', [reference])],
            requestId: 'request-budget',
            turnId: 'active-turn',
            aggregateBudgetBytes: limit,
          }),
        );

        expect(error).toBeInstanceOf(RequestMediaResolutionError);
        expect(error.message).toContain(reference.contentId);
        expect(error.message).toContain('budget-turn');
        expect(resolver.accounting()).toStrictEqual({
          activeRequestCount: 0,
          reservedContentCount: 0,
          materializedNormalizedBytes: 0,
          storeReadCount: 0,
        });
        expect(await mediaStore.hasReservations(reference.contentId)).toBe(
          false,
        );
      },
    );

    it('accepts an aggregate limit exactly equal to normalized selected bytes', async () => {
      const mediaStore = store();
      const reference = await admittedReference(
        mediaStore,
        new Uint8Array([1, 2, 3]),
      );
      const resolver = new RequestMediaResolver(mediaStore);

      const resolved = await resolver.resolve({
        contents: [content('exact-turn', [reference])],
        requestId: 'request-exact',
        turnId: 'active-turn',
        aggregateBudgetBytes: 4,
      });

      expect(
        resolved.withContents((contents) => contents)[0]?.blocks[0],
      ).toMatchObject({
        encoding: 'base64',
        data: 'AQID',
      });
      await resolved.release();
    });

    it('validates every selected reference before reading any blob', async () => {
      const mediaStore = store();
      const first = await admittedReference(
        mediaStore,
        new Uint8Array([1, 2, 3]),
      );
      const malformed = {
        ...first,
        normalizedBase64Length: first.normalizedBase64Length + 1,
      };
      const resolver = new RequestMediaResolver(mediaStore);

      const error = await capturedError(
        resolver.resolve({
          contents: [
            content('valid-turn', [first]),
            content('malformed-turn', [malformed]),
          ],
          requestId: 'request-malformed',
          turnId: 'active-turn',
          aggregateBudgetBytes: 100,
        }),
      );

      expect(error.message).toContain(first.contentId);
      expect(error.message).toContain('malformed-turn');
      expect(resolver.accounting().storeReadCount).toBe(0);
      expect(await mediaStore.hasReservations(first.contentId)).toBe(false);
    });

    it('identifies a missing content ID and turn and releases earlier reservations', async () => {
      const mediaStore = store();
      const first = await admittedReference(
        mediaStore,
        new Uint8Array([1, 2, 3]),
      );
      const missing = await admittedReference(
        mediaStore,
        new Uint8Array([4, 5, 6]),
      );
      await unlink(await objectPath(tempDirectory(), missing));
      const resolver = new RequestMediaResolver(mediaStore);

      const error = await capturedError(
        resolver.resolve({
          contents: [
            content('first-turn', [first]),
            content('missing-turn', [missing]),
          ],
          requestId: 'request-missing',
          turnId: 'active-turn',
          aggregateBudgetBytes: 8,
        }),
      );

      expect(error.message).toContain(missing.contentId);
      expect(error.message).toContain('missing-turn');
      expect(resolver.accounting().storeReadCount).toBe(2);
      expect(await mediaStore.hasReservations(first.contentId)).toBe(false);
    });

    it('includes legacy inline local media in the aggregate request budget', async () => {
      const mediaStore = store();
      const resolver = new RequestMediaResolver(mediaStore);
      const inline = content('inline-budget-turn', [
        {
          type: 'media',
          encoding: 'base64',
          data: 'AQID',
          mimeType: 'image/png',
        },
      ]);

      const error = await capturedError(
        resolver.resolve({
          contents: [inline],
          requestId: 'request-inline-budget',
          turnId: 'active-turn',
          aggregateBudgetBytes: 3,
        }),
      );

      expect(error).toBeInstanceOf(RequestMediaResolutionError);
      expect(error.message).toContain('inline-budget-turn');
      expect(resolver.accounting().storeReadCount).toBe(0);
    });

    it('identifies hash-mismatched bytes and releases request accounting', async () => {
      const mediaStore = store();
      const reference = await admittedReference(
        mediaStore,
        new Uint8Array([1, 2, 3]),
      );
      await writeFile(
        await objectPath(tempDirectory(), reference),
        new Uint8Array([3, 2, 1]),
      );
      const resolver = new RequestMediaResolver(mediaStore);

      const error = await capturedError(
        resolver.resolve({
          contents: [content('hash-turn', [reference])],
          requestId: 'request-hash',
          turnId: 'active-turn',
          aggregateBudgetBytes: 4,
        }),
      );

      expect(error.message).toContain(reference.contentId);
      expect(error.message).toContain('hash-turn');
      expect(resolver.accounting()).toStrictEqual({
        activeRequestCount: 0,
        reservedContentCount: 0,
        materializedNormalizedBytes: 0,
        storeReadCount: 1,
      });
    });

    it('preserves URL and legacy inline media without a store read', async () => {
      const mediaStore = store();
      const selected = [
        content('legacy-turn', [
          {
            type: 'media',
            encoding: 'url',
            data: 'https://example.test/image.png',
            mimeType: 'image/png',
          },
          {
            type: 'media',
            encoding: 'base64',
            data: 'AQID',
            mimeType: 'image/png',
          },
        ]),
      ];
      const resolver = new RequestMediaResolver(mediaStore);

      const resolved = await resolver.resolve({
        contents: selected,
        requestId: 'request-legacy',
        turnId: 'active-turn',
        aggregateBudgetBytes: 4,
      });

      expect(resolved.withContents((contents) => contents)).toStrictEqual(
        selected,
      );
      expect(resolved.accounting().storeReadCount).toBe(0);
      await resolved.release();
    });

    it('exposes bounded recovery after terminal cleanup fails and preserves both failures', async () => {
      const mediaStore = new FailOnceReleaseStore({
        rootDirectory: tempDirectory(),
        quotaBytes: 6,
      });
      const first = await admittedReference(
        mediaStore,
        new Uint8Array([1, 2, 3]),
      );
      const missing = await admittedReference(
        mediaStore,
        new Uint8Array([4, 5, 6]),
      );
      await unlink(await objectPath(tempDirectory(), missing));
      const resolver = new RequestMediaResolver(mediaStore);

      const error = await capturedError(
        resolver.resolve({
          contents: [
            content('reserved-turn', [first]),
            content('missing-turn', [missing]),
          ],
          requestId: 'request-cleanup-recovery',
          turnId: 'active-turn',
          aggregateBudgetBytes: 8,
        }),
      );

      expect(error).toBeInstanceOf(AggregateError);
      expect(error.message).toContain('resolution and cleanup failed');
      expect(resolver.accounting()).toMatchObject({
        activeRequestCount: 1,
        reservedContentCount: 1,
      });
      expect(resolver.pendingReleaseCount()).toBe(1);

      const recovery = await resolver.recoverPendingReleases();

      expect(recovery).toStrictEqual({
        attempted: 1,
        recovered: 1,
        remaining: 0,
      });
      expect(resolver.accounting()).toMatchObject({
        activeRequestCount: 0,
        reservedContentCount: 0,
      });
      expect(resolver.pendingReleaseCount()).toBe(0);
      expect(await mediaStore.hasReservations(first.contentId)).toBe(false);
    });

    it('aborts before reading and leaves no request accounting', async () => {
      const mediaStore = store();
      const reference = await admittedReference(
        mediaStore,
        new Uint8Array([1, 2, 3]),
      );
      const controller = new AbortController();
      controller.abort();
      const resolver = new RequestMediaResolver(mediaStore);

      const error = await capturedError(
        resolver.resolve({
          contents: [content('cancel-turn', [reference])],
          requestId: 'request-cancel',
          turnId: 'active-turn',
          aggregateBudgetBytes: 4,
          signal: controller.signal,
        }),
      );

      expect(error.name).toBe('AbortError');
      expect(resolver.accounting().storeReadCount).toBe(0);
      expect(await mediaStore.hasReservations(reference.contentId)).toBe(false);
    });
  });
});
