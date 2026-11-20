/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { link, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withValueTransformFixture } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { admitDeferredHistorySource } from './deferredHistorySource.js';

function imageRow(index: number, distinctImages: number): IContent {
  const image = index % distinctImages;
  const payload = Buffer.from([
    137,
    80,
    78,
    71,
    image & 255,
    image >> 8,
    1,
    2,
  ]).toString('base64');
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `row ${index}` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: payload,
      },
    ],
    metadata: { turnId: `turn-${index}` },
  };
}

async function* rows(
  count: number,
  distinctImages: number,
): AsyncGenerator<IContent, void> {
  for (let index = 0; index < count; index++)
    yield imageRow(index, distinctImages);
}

describe('deferred history media admission lock cycles', () => {
  let root = '';
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deferred-admission-scaling-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Store lock cycles for the whole admission and release, counted through the lock directory sync each cycle performs twice. */
  async function cyclesFor(
    rowCount: number,
    distinctImages: number,
  ): Promise<number> {
    let lockDirectorySyncs = 0;
    const store = new LocalMediaStore({
      rootDirectory: join(root, `store-${rowCount}-${distinctImages}`),
      quotaBytes: 1 << 24,
      fileOperations: {
        link,
        syncDirectory: async (path) => {
          if (path.endsWith('locks')) lockDirectorySyncs += 1;
        },
      },
    });
    try {
      await withValueTransformFixture(async ({ history }) => {
        const release = await admitDeferredHistorySource(
          history,
          rows(rowCount, distinctImages),
          store,
          {},
          'fake-model',
        );
        await release();
      });
      return lockDirectorySyncs / 2;
    } finally {
      await store.close();
    }
  }

  it('takes the same lock cycles for 4N rows of one image as for N rows', async () => {
    const small = await cyclesFor(16, 1);
    const large = await cyclesFor(64, 1);
    expect(large).toBe(small);
    // Preflight, deduplication check, publication, reservation and release
    // for the one image, whatever the row count.
    expect(large).toBeLessThanOrEqual(5);
  });

  it('takes lock cycles proportional to the distinct images, never to the rows', async () => {
    const small = await cyclesFor(16, 16);
    const large = await cyclesFor(64, 64);
    expect(large / small).toBeGreaterThan(3);
    expect(large / small).toBeLessThan(4.5);
  });
});
