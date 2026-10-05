/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  oneshotSetup,
  oneshotOracle,
  oneshotRow,
  OneshotDiskHistory,
} from './oneshot-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';

function splitBlocks(size: number, index: number): IContent['blocks'] {
  const bottom = Math.floor(size * 0.8);
  const pairs = [
    { call: 1, response: 2, id: 'old-pair' },
    { call: bottom - 1, response: bottom, id: 'split-boundary' },
    { call: bottom + 2, response: bottom + 3, id: 'protected-boundary' },
  ];
  for (const pair of pairs) {
    if (index === pair.call)
      return [
        {
          type: 'tool_call',
          id: pair.id,
          name: pair.id,
          parameters: { index },
        },
      ];
    if (index === pair.response)
      return [
        {
          type: 'tool_response',
          callId: pair.id,
          toolName: pair.id,
          result: { index },
          isComplete: true,
        },
      ];
  }
  return [
    {
      type: 'text',
      text:
        index === Math.floor(size / 2) || index === size - 2
          ? '<state_snapshot>prior facts</state_snapshot>'
          : `split-row-${index}`,
    },
  ];
}
function splitRow(size: number, index: number): IContent {
  const base = oneshotRow(index, 64);
  const blocks = splitBlocks(size, index);
  let speaker: IContent['speaker'] = 'human';
  if (blocks[0]?.type === 'tool_call') speaker = 'ai';
  if (blocks[0]?.type === 'tool_response') speaker = 'tool';
  return {
    ...base,
    speaker,
    blocks,
    metadata: {
      ...base.metadata,
      ...(index === size - 2
        ? {
            isSummary: true,
            synthetic: true,
            reason: 'compression-state-snapshot',
            chronologyReplaced: { fromSeq: 7, toSeq: 9, itemCount: 3 },
          }
        : {}),
      ...(index === size - 1
        ? { semanticMediaPurgeFrontier: { contentIndex: 2, blockIndex: 1 } }
        : {}),
    },
  };
}
function stable(row: IContent, index: number): IContent {
  return index < 2
    ? {
        ...row,
        metadata: { ...row.metadata, chronology: undefined, model: undefined },
      }
    : row;
}
async function split(size: number): Promise<number> {
  const makeRow = (index: number): IContent => splitRow(size, index);
  return withSuffixFixture(
    size,
    async (history) => {
      history.setCacheAnchorSeq(Math.floor(size * 0.95));
      const expected = await oneshotOracle(history, size, 64, makeRow);
      const { handler, transport } = oneshotSetup(history);
      let recorded: IContent | undefined;
      history.on('compressionEnded', (summary) => {
        recorded = summary;
      });
      expect(await handler.performCompression('split')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const rows = await collectRows(history);
      expect(rows.map(stable)).toStrictEqual(expected.rows.map(stable));
      expect(transport.requests).toStrictEqual(expected.requests);
      expect(transport.requests[0]).toContain('old-pair');
      expect(transport.requests[0]).toContain(
        'integrating still-relevant information',
      );
      expect(
        rows.some((row) =>
          row.blocks.some(
            (block) =>
              block.type === 'tool_call' && block.id === 'protected-boundary',
          ),
        ),
      ).toBe(true);
      expect(
        rows.some((row) =>
          row.blocks.some(
            (block) =>
              block.type === 'tool_response' &&
              block.callId === 'protected-boundary',
          ),
        ),
      ).toBe(true);
      expect(recorded?.blocks).toStrictEqual(rows[0].blocks);
      expect(rows[0].metadata?.chronologyReplaced?.itemCount).toBeGreaterThan(
        4,
      );
      expect(rows[0].metadata?.semanticMediaPurgeFrontier).toBeUndefined();
      expect(
        rows[rows.length - 1].metadata?.semanticMediaPurgeFrontier,
      ).toStrictEqual({ contentIndex: 2, blockIndex: 1 });
      expect(history.getCacheAnchorSeq()).toBe(0);
      return rows.length;
    },
    64,
    makeRow,
    undefined,
    (options) => new OneshotDiskHistory(options),
  );
}

describe('one-shot disk tool boundary and snapshot recording', () => {
  it.each([512, 8192])(
    'summarizes old pairs and preserves the protected boundary in %i rows',
    async (size) => {
      expect(await split(size)).toBeGreaterThan(4);
    },
    180_000,
  );
  it('does not publish or record when too few rows are compressible', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const { handler, transport } = oneshotSetup(history);
        let recordings = 0;
        history.on('compressionEnded', () => {
          recordings++;
        });
        expect(await handler.performCompression('noop')).toBe(
          PerformCompressionResult.NOOP,
        );
        expect(transport.requests).toHaveLength(0);
        expect(recordings).toBe(0);
        expect(handler.wasRecentlyCompressed()).toBe(false);
      },
      64,
      oneshotRow,
      undefined,
      (options) => new OneshotDiskHistory(options),
    );
  });
});
