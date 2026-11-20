/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { link } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { resolveRequestMedia } from '../../utils/request-media-resolution.js';
import {
  resolveRowsMedia,
  type RowsMediaInput,
} from '../responses-row-media.js';

/**
 * Counts store lock cycles through the lock directory sync that every cycle
 * performs on acquire and again on release.
 */
function countingStore(root: string): {
  store: LocalMediaStore;
  lockCycles: () => number;
  resetCycles: () => void;
} {
  let lockDirectorySyncs = 0;
  const store = new LocalMediaStore({
    rootDirectory: root,
    quotaBytes: 1 << 24,
    fileOperations: {
      link,
      syncDirectory: async (path) => {
        if (path.endsWith('locks')) lockDirectorySyncs += 1;
      },
    },
  });
  return {
    store,
    lockCycles: () => lockDirectorySyncs / 2,
    resetCycles: () => {
      lockDirectorySyncs = 0;
    },
  };
}

function imageBytes(seed: number): Uint8Array {
  return new Uint8Array([137, 80, 78, 71, seed & 255, seed >> 8, 1, 2]);
}

async function* streamRows(
  references: readonly MediaReferenceBlock[],
  rowCount: number,
): AsyncGenerator<IContent, void> {
  for (let index = 0; index < rowCount; index++) {
    yield {
      speaker: 'human',
      blocks: [
        { type: 'text', text: `row ${index}` },
        references[index % references.length],
      ],
      metadata: { turnId: `turn-${index}` },
    };
  }
}

describe('streamed row media resolution lock cycles', () => {
  let root = '';
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'row-media-scaling-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function cyclesFor(
    rowCount: number,
    distinctImages: number,
  ): Promise<number> {
    const { store, lockCycles, resetCycles } = countingStore(
      join(root, `store-${rowCount}-${distinctImages}`),
    );
    try {
      const references: MediaReferenceBlock[] = [];
      for (let image = 0; image < distinctImages; image++)
        references.push(
          await store.admit({
            bytes: imageBytes(image),
            mimeType: 'image/png',
            semanticMetadata: {},
          }),
        );
      resetCycles();
      const media: RowsMediaInput = {
        requestId: 'scaling',
        resolver: new RequestMediaResolver(store),
      };
      const owner = await resolveRequestMedia(media, [], undefined);
      let resolvedRows = 0;
      for await (const row of resolveRowsMedia(
        streamRows(references, rowCount),
        media,
        owner,
        undefined,
      )) {
        const image = row.blocks[1];
        if (image.type !== 'media' || image.encoding !== 'base64')
          throw new Error('Row media was not materialized');
        resolvedRows += 1;
      }
      await owner.release();
      expect(resolvedRows).toBe(rowCount);
      return lockCycles();
    } finally {
      await store.close();
    }
  }

  it('takes the same lock cycles for 4N rows of one image as for N rows', async () => {
    const small = await cyclesFor(16, 1);
    const large = await cyclesFor(64, 1);
    expect(large).toBe(small);
    // One reservation cycle and one release cycle for the single image.
    expect(large).toBeLessThanOrEqual(2);
  });

  it('takes lock cycles proportional to the distinct images, never to the rows', async () => {
    const small = await cyclesFor(16, 16);
    const large = await cyclesFor(64, 64);
    expect(large / small).toBeGreaterThan(3);
    expect(large / small).toBeLessThan(4.5);
    // One reservation cycle per image plus one batched release.
    expect(large).toBeLessThanOrEqual(64 + 1);
  });
});
