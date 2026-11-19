import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  isMediaDroppedBlock,
  type IContent,
  type MediaDroppedBlock,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { droppedMediaModelText } from '@vybestack/llxprt-code-core/services/history/droppedMediaText.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { withRemovalFixture } from '@vybestack/llxprt-code-core/services/history/history-removals-test-helpers.js';
import { retiredSourceImages } from '../source-image-retirement.js';
const historyScratchRoots = createTestScratchOwner();

const READ_AT = '2026-11-19T18:00:00.000Z';
const DROPPED_AT = '2026-11-19T18:30:00.000Z';

function image(id: string): IContent {
  return {
    speaker: 'human',
    metadata: { turnId: id },
    blocks: [
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'AAAA',
      },
    ],
  };
}

async function storedImage(
  store: LocalMediaStore,
  byte: number,
): Promise<MediaReferenceBlock> {
  const reference = await store.admit({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, byte]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  return {
    ...reference,
    origin: {
      kind: 'file',
      path: `/workspace/screens/shot-${byte}.png`,
      readAt: READ_AT,
    },
  };
}

function turn(id: string, reference: MediaReferenceBlock): IContent {
  return {
    speaker: 'human',
    metadata: { turnId: id },
    blocks: [{ type: 'text', text: `image ${id}` }, reference],
  };
}

/** Journal labels of the rows that carry media, in request order. */
async function mediaLabels(
  source: ProviderRequestSelection,
): Promise<bigint[]> {
  const native = source.native;
  if (native === undefined) throw new Error('expected a journal request');
  const labels: bigint[] = [];
  for await (const row of native.indexed.openMediaRows())
    labels.push(row.label);
  return labels;
}

async function retiredFrom(
  history: HistoryService,
  protectedContents: IContent[],
  retireAll = true,
): Promise<{
  readonly retired: Awaited<ReturnType<typeof retiredSourceImages>>;
  readonly labels: bigint[];
}> {
  const source = await history.prepareCuratedForProviderSnapshot();
  try {
    return {
      retired: await retiredSourceImages(
        source,
        protectedContents,
        1000,
        retireAll,
      ),
      labels: await mediaLabels(source),
    };
  } finally {
    await source.close();
  }
}

function droppedBlock(row: IContent): MediaDroppedBlock {
  const block = row.blocks[1];
  if (!isMediaDroppedBlock(block)) throw new Error('expected a dropped image');
  return block;
}

describe('journal source image retirement', () => {
  it('discovers retirement without reading unrelated text rows or opening a whole-history reader', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    await history.addBatch([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'x'.repeat(128 * 1024) }],
      },
      image('old'),
      image('pending'),
    ]);
    const source = await history.prepareCuratedForProviderSnapshot();
    try {
      const rows = spyOn(
        VersionSnapshot.prototype,
        'readRow',
      ).mockImplementation(() => {
        throw new Error('Whole row materialization during media discovery');
      });
      const stream = spyOn(source, 'openReader').mockImplementation(() => {
        throw new Error('Whole history traversal during media discovery');
      });
      let retired: Awaited<ReturnType<typeof retiredSourceImages>> = [];
      try {
        retired = await retiredSourceImages(
          source,
          [image('pending')],
          1000,
          true,
        );
      } finally {
        rows.mockRestore();
        stream.mockRestore();
      }
      const [old] = await mediaLabels(source);
      expect(retired).toStrictEqual([{ label: old, blockIndex: 0 }]);
    } finally {
      await source.close();
    }
  });

  it('drops the oldest images in stored history as references and releases a blob no row references', async () => {
    await withRemovalFixture(async ({ history }, store) => {
      const shared = await storedImage(store, 1);
      const alone = await storedImage(store, 2);
      const pending = turn('pending', shared);
      history.add(turn('old1', shared));
      history.add(turn('old2', alone));
      history.add(pending);
      await history.settleMediaOwnership();
      const source = await history.prepareCuratedForProviderSnapshot();
      let retired: Awaited<ReturnType<typeof retiredSourceImages>>;
      try {
        retired = await retiredSourceImages(source, [pending], 10);
      } finally {
        await source.close();
      }
      expect(retired.map(({ blockIndex }) => blockIndex)).toStrictEqual([1, 1]);

      await history.dropMedia(retired, DROPPED_AT);
      await history.waitForOwnershipSettlement();

      const stored: IContent[] = [];
      for await (const row of history.streamRawHistory()) stored.push(row);
      expect(stored.slice(0, 2).map((row) => droppedBlock(row))).toStrictEqual(
        [shared, alone].map(
          (reference): MediaDroppedBlock => ({
            type: 'media_dropped',
            origin: {
              kind: 'file',
              path: `/workspace/screens/shot-${reference === shared ? 1 : 2}.png`,
              readAt: READ_AT,
            },
            mimeType: 'image/png',
            byteLength: reference.byteLength,
            contentId: reference.contentId,
            droppedAt: DROPPED_AT,
          }),
        ),
      );
      expect(stored[2].blocks).toStrictEqual(pending.blocks);
      expect(await store.hasReservations(shared.contentId)).toBe(true);
      expect(await store.hasReservations(alone.contentId)).toBe(false);

      const request = await history.prepareCuratedForProviderSnapshot();
      try {
        const sent: IContent[] = [];
        for await (const row of request.openReader()) sent.push(row);
        expect(sent[1].blocks[1]).toStrictEqual(droppedBlock(stored[1]));
        expect(droppedMediaModelText(droppedBlock(sent[1]))).toContain(
          '/workspace/screens/shot-2.png',
        );
        expect(sent[2].blocks).toStrictEqual(pending.blocks);
      } finally {
        await request.close();
      }
    });
  }, 60000);

  it('keeps retirement disabled for an explicit zero budget', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    await history.addBatch([image('old'), image('new')]);
    const source = await history.prepareCuratedForProviderSnapshot();
    try {
      expect(await retiredSourceImages(source, [], 0)).toStrictEqual([]);
    } finally {
      await source.close();
    }
  });

  it('relieves every historical image without retiring a repeated pending attachment', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    const pending = image('new');
    await history.addBatch([image('old'), pending]);
    const { retired, labels } = await retiredFrom(history, [pending]);
    expect(retired).toStrictEqual([{ label: labels[0], blockIndex: 0 }]);
  });

  it('does not protect an older unlabeled copy beyond the pending occurrence count', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    const older = { ...image('older'), metadata: undefined };
    const first = image('now');
    const last = image('now');
    const declared = { ...first, blocks: [...first.blocks, ...first.blocks] };
    await history.addBatch([older, first, last]);
    const { retired, labels } = await retiredFrom(history, [declared]);
    expect(retired).toStrictEqual([{ label: labels[0], blockIndex: 0 }]);
  });

  it('stops provenance extension at an unrelated text row', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    const fragment = image('now');
    const note: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'unrelated' }],
    };
    await history.addBatch([fragment, note, fragment, fragment]);
    const { retired, labels } = await retiredFrom(history, [fragment]);
    expect(retired).toStrictEqual([{ label: labels[0], blockIndex: 0 }]);
  });
});
