import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import type { ProviderRequestSelection } from './provider-request-snapshot.js';
const historyScratchRoots = createTestScratchOwner();

async function blockCounts(
  view: ProviderRequestSelection,
): Promise<{ mediaCount: number; notes: number }> {
  let mediaCount = 0;
  let notes = 0;
  for await (const row of view.openReader())
    for (const block of row.blocks) {
      if (block.type === 'media') mediaCount++;
      if (block.type === 'text' && block.text === 'retired pixels') notes++;
    }
  return { mediaCount, notes };
}

describe('sparse journal request block overlays', () => {
  it('recomputes an earlier call unit when retirement rewrites media beside its response', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    await history.addBatch([
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_image',
            name: 'read_image',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_image',
            toolName: 'read_image',
            result: 'loaded',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'AAAA',
          },
        ],
      },
    ]);
    const source = await history.prepareCuratedForProviderSnapshot();
    if (source.native === undefined) throw new Error('Missing journal source');
    const callLabel = (await source.native.indexed.unitEntryAt(0)).entry.label;
    let mediaLabel: bigint | undefined;
    for await (const media of source.native.indexed.openMediaRows()) {
      mediaLabel = media.label;
      break;
    }
    if (mediaLabel === undefined) throw new Error('Missing media row');
    const view = await source.native.project({
      blockReplacements: new Map([
        [mediaLabel, new Map([[1, { type: 'text', text: 'retired pixels' }]])],
      ]),
      header: (row) => row,
    });
    try {
      const native = view.native;
      if (native === undefined) throw new Error('Missing projected source');
      expect(
        [...native.indexed.viewPlan.changedSources].some(
          (row) => row.entry.label === callLabel,
        ),
      ).toBe(true);
      expect(await blockCounts(view)).toStrictEqual({
        mediaCount: 0,
        notes: 1,
      });
    } finally {
      await view.close();
      await source.close();
    }
  });
  it('replaces historical pixels in native plans without rewriting durable rows or pending media', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    const image: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'AAAA',
        },
      ],
    };
    await history.addBatch([
      image,
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'seen' }],
        metadata: { id: 'resp_old', responsesStored: true },
      },
    ]);
    const original = await history.prepareCuratedForProviderSnapshot([image]);
    try {
      const native = original.native;
      if (native === undefined)
        throw new Error('Expected native journal source');
      const entry = await native.indexed.unitEntryAt(0);
      const projected = await native.project({
        blockReplacements: new Map([
          [
            entry.entry.label,
            new Map([[0, { type: 'text', text: 'retired pixels' }]]),
          ],
        ]),
        header: (row, label) =>
          label < entry.entry.label || row.metadata === undefined
            ? row
            : {
                ...row,
                metadata: { ...row.metadata, responsesStored: undefined },
              },
      });
      try {
        expect(projected.native).toBeDefined();
        expect((await projected.readAt(0)).blocks).toStrictEqual([
          { type: 'text', text: 'retired pixels' },
        ]);
        expect(
          (await projected.readAt(1)).metadata?.responsesStored,
        ).toBeUndefined();
        expect((await projected.readAt(2)).blocks).toStrictEqual(image.blocks);
        const plan = await projected.native?.indexed.planAt(0);
        if (plan === undefined) throw new Error('Expected native plan');
        const blocks = [];
        for await (const block of plan.openBlocks()) blocks.push(block);
        expect(blocks).toStrictEqual([
          { type: 'text', text: 'retired pixels' },
        ]);
        expect((await original.readAt(0)).blocks).toStrictEqual(image.blocks);
        expect((await original.readAt(1)).metadata?.responsesStored).toBe(true);
      } finally {
        await projected.close();
      }
    } finally {
      await original.close();
    }
    const unchanged = await history.prepareCuratedForProviderSnapshot();
    try {
      expect((await unchanged.readAt(0)).blocks).toStrictEqual(image.blocks);
      expect((await unchanged.readAt(1)).metadata?.responsesStored).toBe(true);
    } finally {
      await unchanged.close();
    }
  });
  it('applies sparse retirement after a selected-row purge after the original pin closes', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    const row: IContent = {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'remove this' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'AAAA',
        },
      ],
    };
    await history.addBatch([row]);
    const original = await history.prepareCuratedForProviderSnapshot();
    const native = original.native;
    if (native === undefined) throw new Error('Missing journal source');
    const label = (await native.indexed.unitEntryAt(0)).entry.label;
    const purged = await native.project({
      label,
      removedBlock: 0,
      readChangedRow: async () => ({ ...row, blocks: row.blocks.slice(1) }),
      header: (content) => content,
    });
    const purgedNative = purged.native;
    if (purgedNative === undefined) throw new Error('Missing purged source');
    const view = await purgedNative.project({
      blockReplacements: new Map([
        [label, new Map([[0, { type: 'text', text: 'retired pixels' }]])],
      ]),
      header: (content) => content,
    });
    await original.close();
    await purged.close();
    try {
      expect((await view.readAt(0)).blocks).toStrictEqual([
        { type: 'text', text: 'retired pixels' },
      ]);
      const plan = await view.native?.indexed.planAt(0);
      if (plan === undefined) throw new Error('Missing projected plan');
      const blocks = [];
      for await (const block of plan.openBlocks()) blocks.push(block);
      expect(blocks).toStrictEqual([{ type: 'text', text: 'retired pixels' }]);
    } finally {
      await view.close();
    }
  });
  it('invalidates stored response parents in a pending tail after historical retirement', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    await history.addBatch([
      { speaker: 'human', blocks: [{ type: 'text', text: 'old' }] },
    ]);
    const source = await history.prepareCuratedForProviderSnapshot([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'answer' }],
        metadata: { id: 'resp_tail', responsesStored: true },
      },
    ]);
    if (source.native === undefined) throw new Error('Missing journal source');
    const view = await source.native.project({
      header: (row) => ({
        ...row,
        metadata: { ...row.metadata, responsesStored: undefined },
      }),
    });
    try {
      expect((await view.readAt(1)).metadata?.responsesStored).toBeUndefined();
      expect((await source.readAt(1)).metadata?.responsesStored).toBe(true);
    } finally {
      await view.close();
      await source.close();
    }
  });
});
