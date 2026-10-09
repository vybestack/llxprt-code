/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '../services/history/IContent.js';
import { withCoreSuffixFixture } from '../services/history/core-suffix-fixture-test-helpers.js';
import { MediaLifecycleMetrics } from './media-lifecycle-metrics.js';
import {
  metricReference,
  metricRow,
  metricSources,
  metricScratch,
  metricScratchChanges,
  StreamMetricHistory,
  withMetricStore,
} from './media-metrics-test-helpers.js';

async function withRows<T>(
  rows: readonly IContent[],
  action: (history: StreamMetricHistory) => Promise<T>,
): Promise<T> {
  const history = new StreamMetricHistory();
  try {
    for (const row of rows) history.add(row);
    return await action(history);
  } finally {
    history.dispose();
  }
}

describe('media metric snapshot lifetime', () => {
  it('pins at invocation and samples all live owners before asynchronous work', async () => {
    await withMetricStore(async (store) =>
      withRows([metricRow(0, 0), metricRow(1, 0)], async (history) => {
        let bytes = 321;
        const sources = metricSources(store, history);
        const metrics = new MediaLifecycleMetrics({
          ...sources,
          requestResolver: {
            accounting: () => ({ materializedNormalizedBytes: bytes }),
          },
          recording: { getPendingByteCount: () => bytes + 1 },
          persistence: { getPendingByteCount: () => bytes + 2 },
          providerFileRetention: {
            snapshot: () => ({ retainedBytes: bytes + 3 }),
          },
          decodedImageCache: {
            snapshot: () => ({ entries: 2, bytes: bytes + 4 }),
          },
        });
        const pending = metrics.snapshot();
        history.clear();
        history.add(metricRow(9, 0));
        bytes = 0;
        const snapshot = await pending;
        expect(snapshot.localRetainedBlobBytes).toBe(32);
        expect(snapshot.residentEncodedBytes).toBe(16);
        expect(snapshot.activeRequestMaterializationBytes).toBe(321);
        expect(snapshot.recordingQueueBytes).toBe(322);
        expect(snapshot.persistenceQueueBytes).toBe(323);
        expect(snapshot.providerFileRetainedBytes).toBe(324);
        expect(snapshot.decodedImageCache).toStrictEqual({
          available: true,
          entries: 2,
          bytes: 325,
        });
        expect((await metrics.snapshot()).localRetainedBlobBytes).toBe(32);
      }),
    );
  });

  it('rejects late inconsistent duplicate byte lengths and cleans scratch and readers', async () => {
    const before = metricScratch();
    await withMetricStore(async (store) =>
      withCoreSuffixFixture(
        512,
        async (history, owners) => {
          await expect(
            new MediaLifecycleMetrics(metricSources(store, history)).snapshot(),
          ).rejects.toThrow('inconsistent byte lengths');
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.snapshot().liveSerializedBytes).toBe(0);
          expect(metricScratchChanges(before)).toStrictEqual({
            added: [],
            removed: [],
          });
        },
        0,
        (index) => ({
          ...metricRow(index, 0),
          blocks: [metricReference(0, index === 511 ? 17 : 16)],
        }),
        undefined,
        (options) => new StreamMetricHistory(options),
      ),
    );
  }, 120_000);
});

describe('media metric byte validation', () => {
  it('accepts a valid row larger than eight MiB without capping input', async () => {
    await withMetricStore(async (store) =>
      withCoreSuffixFixture(
        1,
        async (history, owners) => {
          const snapshot = await new MediaLifecycleMetrics(
            metricSources(store, history),
          ).snapshot();
          expect(snapshot.residentEncodedBytes).toBe(12 * 1024 * 1024);
          expect(snapshot.localRetainedBlobBytes).toBe(0);
          expect(owners.snapshot().peakSerializedBytes).toBeGreaterThan(
            8 * 1024 * 1024,
          );
          expect(owners.snapshot().peakRows).toBe(1);
          expect(owners.snapshot().liveRows).toBe(0);
        },
        0,
        () => ({
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'audio/wav',
              data: 'aGVs'.repeat(3 * 1024 * 1024),
            },
          ],
        }),
        undefined,
        (options) => new StreamMetricHistory(options),
      ),
    );
  }, 120_000);

  it('keeps validation of negative, fractional and overflowing byte totals', async () => {
    await withMetricStore(async (store) => {
      for (const bytes of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        await withRows(
          [{ speaker: 'human', blocks: [metricReference(0, bytes)] }],
          async (history) => {
            await expect(
              new MediaLifecycleMetrics(
                metricSources(store, history),
              ).snapshot(),
            ).rejects.toThrow('safe integer');
          },
        );
      }
      await withRows(
        [
          {
            speaker: 'human',
            blocks: [
              metricReference(0, Number.MAX_SAFE_INTEGER),
              metricReference(1, 1),
            ],
          },
        ],
        async (history) => {
          await expect(
            new MediaLifecycleMetrics(metricSources(store, history)).snapshot(),
          ).rejects.toThrow('safe integer');
        },
      );
    });
  });
});
