/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { applyCompressionValuesWithAnchor } from '../cache-anchor-values.js';
import { summaryOutput } from '../summaryOutput.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  truncationValueRow,
  truncationValues,
} from './truncation-value-helpers.js';

const summary: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: '<state_snapshot>summary</state_snapshot>' }],
  metadata: {
    chronology: { seq: 10000, userTurn: 1, step: 0, recordedAt: 0 },
    isSummary: true,
    reason: 'compression-state-snapshot',
    responsesStored: true,
  },
};

describe('native cache-anchor span publication', () => {
  it.each([3, 64, 65, 5000])(
    'matches independent array annotation and counted marker bytes at %i source rows without creating files',
    async (size) => {
      await withNativeFallbackFixture(async ({ history, durable }) => {
        await history.detachedValues.replace(truncationValues(size, 0, 64));
        history.setBaseTokenOffset(37);
        const source = await history.openCompressionInput();
        try {
          const top = size === 3 ? 1 : 2;
          const bottom = size === 3 ? 2 : size - 2;
          const start = top - 1;
          const output = summaryOutput(source.rows, top, bottom, [summary]);
          if (output.kind !== 'applied')
            throw new Error('Missing summary output');
          const before = Array.from({ length: size }, (_, index) =>
            truncationValueRow(index, 64),
          );
          const kept = [
            ...before.slice(0, top),
            summary,
            ...before.slice(bottom),
          ].slice(start);
          const expected = annotateCompressionSpan(before, kept).map(
            (row, index) => {
              const metadata = { ...row.metadata };
              delete metadata.cacheAnchor;
              if (index === 0) metadata.cacheAnchor = true;
              return invalidateResponsesStatefulChain([
                { ...row, metadata },
              ])[0];
            },
          );
          const digest = await compressionValueDigest(
            (async function* () {
              yield* expected;
            })(),
          );
          const creates = await operationFileCreates(async () => {
            const selected = await applyCompressionValuesWithAnchor(
              history,
              source.previous,
              output.candidate,
              start,
              'test',
              1,
            );
            expect(selected?.metadata?.chronologyReplaced).toStrictEqual(
              expected[1].metadata?.chronologyReplaced,
            );
          }, true);
          expect(creates).toStrictEqual({ directories: [], files: [] });
          expect(
            await compressionValueDigest(history.streamRawHistory()),
          ).toStrictEqual(digest);
          expect(await durable()).toStrictEqual(digest);
          expect(history.getCacheAnchorSeq()).toBe(top);
          expect(history.getTotalTokens()).toBe(expected.length + 37);
          expect(summary.metadata?.chronologyReplaced).toBeUndefined();
        } finally {
          await source.close();
        }
      });
    },
    180_000,
  );
});
