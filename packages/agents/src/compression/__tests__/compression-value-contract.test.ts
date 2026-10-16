/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import {
  withDetachedFixture,
  detachedRows,
  detachedRow,
} from '../../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  compressionValueDigest,
  compressionDurableValueDigest,
} from './compression-value-fixture.js';
import { applyCompressionValuesWithAnchor } from '../cache-anchor-values.js';

async function withCandidate(
  action: (
    history: HistoryService,
    previous: HistoryDumpSnapshot,
    candidate: HistoryDensityRows,
  ) => Promise<void>,
): Promise<void> {
  await withDetachedFixture(async ({ history }) => {
    await history.detachedValues.replace(detachedRows(8, 16));
    const previous = await history.openDumpSnapshot();
    const candidate = new HistoryDensityRows();
    try {
      for (let index = 0; index < 4; index++)
        candidate.append(detachedRow(index, 16));
      candidate.append({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: '<state_snapshot>facts</state_snapshot>' },
        ],
        metadata: {
          isSummary: true,
          reason: 'compression-state-snapshot',
          responsesStored: true,
        },
      });
      await action(history, previous, candidate);
    } finally {
      candidate.close();
      await previous.close();
    }
  });
}

describe('explicit compression value contract validation', () => {
  it('rejects an invalid preserved-head position before changing membership or the anchor', async () => {
    await withCandidate(async (history, previous, candidate) => {
      const baseline = await compressionValueDigest(detachedRows(8, 16));
      history.setCacheAnchorSeq(1);
      await expect(
        applyCompressionValuesWithAnchor(
          history,
          previous,
          candidate,
          0,
          'test',
          6,
        ),
      ).rejects.toThrow('exceeds candidate length');
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(baseline);
      expect(history.getCacheAnchorSeq()).toBe(1);
    });
  });
  it('rejects a preserved head without a chronology value before publication', async () => {
    await withCandidate(async (history, previous, candidate) => {
      const baseline = await compressionValueDigest(detachedRows(8, 16));
      await expect(
        applyCompressionValuesWithAnchor(
          history,
          previous,
          candidate,
          0,
          'test',
          5,
        ),
      ).rejects.toThrow('no valid chronology seq');
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(baseline);
    });
  });
});

describe('explicit compression value chronology and anchor publication', () => {
  it('preserves chronology values without promising the source marker object and clears all markers when the prefix is destroyed', async () => {
    await withCandidate(async (history, previous, candidate) => {
      const original = candidate.readRow(0);
      const marker = original.metadata?.chronology;
      const summary = await applyCompressionValuesWithAnchor(
        history,
        previous,
        candidate,
        0,
        'test',
        0,
      );
      let count = 0;
      let markers = 0;
      let first: IContent | undefined;
      for await (const row of history.streamRawHistory()) {
        first ??= row;
        markers += row.metadata?.cacheAnchor === true ? 1 : 0;
        count++;
      }
      expect(first?.metadata?.chronology).toStrictEqual(marker);
      expect(first?.metadata?.chronology).not.toBe(marker);
      expect({
        count,
        markers,
        anchor: history.getCacheAnchorSeq(),
      }).toStrictEqual({ count: 5, markers: 0, anchor: 0 });
      expect(summary?.metadata?.chronologyReplaced).toStrictEqual({
        fromSeq: 5,
        toSeq: 8,
        itemCount: 4,
      });
      expect(summary?.metadata?.responsesStored).toBeUndefined();
    });
  });
});

describe('explicit compression value cancellation', () => {
  it('preserves abort identity, durable values and the old anchor after an acknowledged cancellation, then retries', async () => {
    await withDetachedFixture(async ({ history, recorder }) => {
      await history.detachedValues.replace(detachedRows(8, 16));
      const baseline = await compressionValueDigest(detachedRows(8, 16));
      const previous = await history.openDumpSnapshot();
      const candidate = new HistoryDensityRows();
      try {
        for (let index = 0; index < 4; index++)
          candidate.append(detachedRow(index, 16));
        const controller = new AbortController();
        const reason = new Error('cancel value publication');
        history.setCacheAnchorSeq(1);
        const operation = applyCompressionValuesWithAnchor(
          history,
          previous,
          candidate,
          0,
          'test',
          2,
          {
            signal: controller.signal,
            afterPublication: () => {
              controller.abort(reason);
            },
          },
        ).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(await operation).toBe(reason);
        await recorder.flush();
        expect(await compressionDurableValueDigest(recorder)).toStrictEqual(
          baseline,
        );
        expect(history.getCacheAnchorSeq()).toBe(1);
        await applyCompressionValuesWithAnchor(
          history,
          previous,
          candidate,
          0,
          'test',
          2,
        );
        expect(history.getCacheAnchorSeq()).toBe(2);
      } finally {
        candidate.close();
        await previous.close();
      }
    });
  });
});
