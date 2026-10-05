/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
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

for (const size of [512, 8192]) {
  describe(`raw media metric stream ${size}`, () => {
    it('counts unique references and every inline occurrence without retaining history', async () => {
      await withMetricStore(async (store) =>
        withSuffixFixture(
          size,
          async (history, owners, counters) => {
            const before = metricScratch();
            const metrics = new MediaLifecycleMetrics(
              metricSources(store, history),
            );
            const snapshot = await metrics.snapshot();
            expect(snapshot.localRetainedBlobBytes).toBe(size * 16);
            expect(snapshot.residentEncodedBytes).toBe(size * 8);
            expect(counters.snapshot().rowsDecoded).toBe(size);
            expect(counters.snapshot().peakDecodedRows).toBe(1);
            expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
            expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
              8 * 1024 * 1024,
            );
            expect(owners.snapshot().liveRows).toBe(0);
            expect(owners.snapshot().liveSerializedBytes).toBe(0);
            expect(metricScratchChanges(before)).toStrictEqual({
              added: [],
              removed: [],
            });
            history.clear();
            const empty = await metrics.snapshot();
            expect(
              empty.localRetainedBlobBytes + empty.residentEncodedBytes,
            ).toBe(0);
          },
          20_000,
          metricRow,
          undefined,
          (options) => new StreamMetricHistory(options),
        ),
      );
    }, 120_000);

    it('leaves raw serialization byte-equivalent', async () => {
      await withMetricStore(async (store) =>
        withSuffixFixture(
          size,
          async (history) => {
            await new MediaLifecycleMetrics(
              metricSources(store, history),
            ).snapshot();
            const actual = createHash('sha256');
            const expected = createHash('sha256');
            let index = 0;
            for await (const row of history.streamRawHistory()) {
              actual.update(JSON.stringify(row) + '\n');
              const original = metricRow(index++, 20_000);
              expected.update(JSON.stringify(original) + '\n');
            }
            expect(index).toBe(size);
            expect(actual.digest('hex')).toBe(expected.digest('hex'));
          },
          20_000,
          metricRow,
          undefined,
          (options) => new StreamMetricHistory(options),
        ),
      );
    }, 120_000);
  });
}
