/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '../services/history/IContent.js';
import { withSuffixFixture } from '../services/history/history-suffix-test-helpers.js';
import { MediaLifecycleMetrics } from './media-lifecycle-metrics.js';
import {
  metricRow,
  metricSources,
  metricScratch,
  metricScratchChanges,
  StreamMetricHistory,
  withMetricStore,
} from './media-metrics-test-helpers.js';

class FailedMetricHistory extends StreamMetricHistory {
  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    let count = 0;
    for await (const row of super.streamRawHistory(signal)) {
      yield row;
      if (++count === 8) throw new Error('metric source failed');
    }
  }
}

class AbortedMetricHistory extends StreamMetricHistory {
  readonly abort = new AbortController();

  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of super.streamRawHistory(signal)) {
      yield row;
      this.abort.abort(new Error('metric cancelled'));
    }
  }
}

describe('media metric failure settlement', () => {
  it('closes the disk index and pinned raw reader on source failure', async () => {
    const before = metricScratch();
    await withMetricStore(async (store) =>
      withSuffixFixture(
        512,
        async (history, owners) => {
          await expect(
            new MediaLifecycleMetrics(metricSources(store, history)).snapshot(),
          ).rejects.toThrow('metric source failed');
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.snapshot().liveSerializedBytes).toBe(0);
          expect(metricScratchChanges(before)).toStrictEqual({
            added: [],
            removed: [],
          });
        },
        0,
        metricRow,
        undefined,
        (journal) => new FailedMetricHistory(journal),
      ),
    );
  }, 120_000);

  it('closes a reader started before a synchronous owner sampler throws', async () => {
    const before = metricScratch();
    await withMetricStore(async (store) =>
      withSuffixFixture(
        512,
        async (history, owners) => {
          const sources = metricSources(store, history);
          await expect(
            new MediaLifecycleMetrics({
              ...sources,
              recording: {
                getPendingByteCount: () => {
                  throw new Error('queue sampler failed');
                },
              },
            }).snapshot(),
          ).rejects.toThrow('queue sampler failed');
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.snapshot().liveSerializedBytes).toBe(0);
          expect(metricScratchChanges(before)).toStrictEqual({
            added: [],
            removed: [],
          });
        },
        0,
        metricRow,
        undefined,
        (journal) => new StreamMetricHistory(journal),
      ),
    );
  }, 120_000);
});

describe('media metric cancellation', () => {
  it('cancels after a media row and rejects pre-aborted traversal without decoded rows', async () => {
    const before = metricScratch();
    let aborted: AbortedMetricHistory | undefined;
    await withMetricStore(async (store) =>
      withSuffixFixture(
        512,
        async (history, owners, counters) => {
          if (aborted === undefined) throw new Error('Missing abort fixture');
          const metrics = new MediaLifecycleMetrics(
            metricSources(store, history),
          );
          await expect(metrics.snapshot(aborted.abort.signal)).rejects.toThrow(
            'metric cancelled',
          );
          expect(owners.snapshot().liveRows).toBe(0);
          const count = counters.snapshot().rowsDecoded;
          await expect(
            metrics.snapshot(aborted.abort.signal),
          ).rejects.toMatchObject({
            message: 'metric cancelled',
            name: 'Error',
          });
          expect(counters.snapshot().rowsDecoded - count).toBe(0);
          expect(metricScratchChanges(before)).toStrictEqual({
            added: [],
            removed: [],
          });
        },
        0,
        metricRow,
        undefined,
        (journal) => {
          aborted = new AbortedMetricHistory(journal);
          return aborted;
        },
      ),
    );
  }, 120_000);
});
