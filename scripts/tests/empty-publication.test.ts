/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { applyCompressionWithAnchor } from '../../packages/agents/src/compression/cacheAnchor.js';
import { truncateLargestToolResponses } from '../../packages/agents/src/compression/toolResultTruncator.js';
import {
  collect,
  compareBodies,
  compressionCandidate,
  eagerCompression,
  eagerTools,
  eagerTokens,
  estimate,
  fixtureRow,
  fixtureWithStoredEmptyTail,
  logger,
  saveRows,
} from './empty-publication-helpers.js';

describe('existing empty AI rows at producer publication', () => {
  it('normalizes the compressed candidate without losing signed thinking, media, chronology or the pinned original', async () => {
    await withSuffixFixture(
      12,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        history.setBaseTokenOffset(7);
        const original = await history.openDumpSnapshot();
        const before = Array.from({ length: 12 }, (_, index) =>
          fixtureRow(index),
        );
        const initialRows = await collect(original.rows());
        expect(initialRows).toStrictEqual(before);
        const candidate = compressionCandidate();
        const candidateBefore = structuredClone(candidate);
        try {
          const failure = await rejectedValue(
            applyCompressionWithAnchor(history, candidate, 3, 'test'),
          );
          const rows = await collect(history.streamRawHistory());
          const expected = eagerCompression();
          const body = await compareBodies(
            history,
            expected,
            'minimal-compression',
          );
          await saveRows(before, 'compression-original');
          await saveRows(rows, 'compression-published');
          expect(await collect(original.rows())).toStrictEqual(before);
          expect(candidate).toStrictEqual(candidateBefore);
          expect(failure).toBeUndefined();
          expect(rows).toStrictEqual(expected);
          expect(rows.map((row) => row.metadata?.chronology)).toStrictEqual(
            expected.map((row) => row.metadata?.chronology),
          );
          expect(history.getTotalTokens()).toBe(eagerTokens(expected) + 7);
          expect(history.getBaseTokenOffset()).toBe(7);
          expect(history.getCacheAnchorSeq()).toBe(3);
          expect(body.actual).toBe(body.expected);
        } finally {
          await original.close();
        }
      },
      0,
      fixtureRow,
    );
  });
});

describe('existing empty AI rows at tool publication', () => {
  it('keeps normalized ranking ordinals stable across two history tool replacements', async () => {
    await withSuffixFixture(
      12,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        history.setBaseTokenOffset(7);
        history.setCacheAnchorSeq(3);
        const original = await history.openDumpSnapshot();
        const before = Array.from({ length: 12 }, (_, index) =>
          fixtureRow(index),
        );
        const initialRows = await collect(original.rows());
        expect(initialRows).toStrictEqual(before);
        try {
          let projections = 0;
          let failure: unknown;
          let result:
            | Awaited<ReturnType<typeof truncateLargestToolResponses>>
            | undefined;
          try {
            result = await truncateLargestToolResponses(
              {
                historyService: history,
                logger,
                estimateBlockTokensAsync: estimate,
                computeProjected: async () => (++projections < 2 ? 200 : 0),
                resetBaseline: () => {},
                getRuntimeModel: () => 'test',
              },
              100,
            );
          } catch (error) {
            failure = error;
          }
          const rows = await collect(history.streamRawHistory());
          const expected = eagerTools();
          const body = await compareBodies(history, expected, 'minimal-tools');
          await saveRows(before, 'tools-original');
          await saveRows(rows, 'tools-published');
          expect(await collect(original.rows())).toStrictEqual(before);
          expect(failure).toBeUndefined();
          expect(result).toMatchObject({ replacedCount: 2, success: true });
          expect(rows).toStrictEqual(expected);
          expect(rows.map((row) => row.metadata?.chronology)).toStrictEqual(
            expected.map((row) => row.metadata?.chronology),
          );
          expect(history.getTotalTokens()).toBe(eagerTokens(expected) + 7);
          expect(history.getBaseTokenOffset()).toBe(7);
          expect(history.getCacheAnchorSeq()).toBe(3);
          expect(body.actual).toBe(body.expected);
        } finally {
          await original.close();
        }
      },
      0,
      fixtureRow,
    );
  });
});

describe('existing empty AI rows and public admission', () => {
  it.each(['append', 'replace', 'transform'])(
    'rejects a NEW empty AI row through public %s without changing accepted raw history',
    async (route) => {
      await withSuffixFixture(
        12,
        async (history) => {
          const before = Array.from({ length: 12 }, (_, index) =>
            fixtureRow(index),
          );
          const initialRows = await collect(history.streamRawHistory());
          expect(initialRows).toStrictEqual(before);
          const empty = fixtureRow(1);
          let operation: Promise<void>;
          if (route === 'append') operation = history.addBatch([empty], 'test');
          else if (route === 'replace')
            operation = history.replaceBatch([empty], 'test');
          else
            operation = history.detachedValues.transform(
              async (_source, sink) => {
                sink.appendValue(empty);
              },
              'test',
            );
          const failure = await rejectedValue(operation);
          expect(failure).toBeInstanceOf(Error);
          expect(failure instanceof Error ? failure.message : '').toContain(
            'content has no blocks',
          );
          expect(await collect(history.streamRawHistory())).toStrictEqual(
            before,
          );
        },
        0,
        fixtureRow,
      );
    },
  );
});

describe('existing empty AI rows carrying a stored Responses parent', () => {
  it('invalidates retained parent markers when the only parent after a rewritten tool row is empty', async () => {
    await withSuffixFixture(
      12,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        history.setBaseTokenOffset(7);
        history.setCacheAnchorSeq(3);
        const original = await history.openDumpSnapshot();
        const before = Array.from({ length: 12 }, (_, index) =>
          fixtureWithStoredEmptyTail(index),
        );
        try {
          const initialRows = await collect(original.rows());
          expect(initialRows).toStrictEqual(before);
          const result = await truncateLargestToolResponses(
            {
              historyService: history,
              logger,
              estimateBlockTokensAsync: estimate,
              computeProjected: async () => 0,
              resetBaseline: () => {},
              getRuntimeModel: () => 'test',
            },
            100,
          );
          const expected = eagerTools()
            .filter((row) => row.metadata?.chronology?.seq !== 12)
            .map((row) =>
              row.metadata?.chronology?.seq === 5 ? fixtureRow(4) : row,
            );
          const rows = await collect(history.streamRawHistory());
          const body = await compareBodies(
            history,
            expected,
            'stored-empty-parent',
          );
          await saveRows(before, 'stored-empty-parent-original');
          await saveRows(rows, 'stored-empty-parent-published');
          expect(result).toMatchObject({ replacedCount: 1, success: true });
          expect(await collect(original.rows())).toStrictEqual(before);
          expect(rows).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(eagerTokens(expected) + 7);
          expect(history.getCacheAnchorSeq()).toBe(3);
          expect(body.actual).toBe(body.expected);
        } finally {
          await original.close();
        }
      },
      0,
      fixtureWithStoredEmptyTail,
    );
  });
});
