/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { MediaLifecycleMetrics } from './media-lifecycle-metrics.js';
import {
  metricSources,
  StreamMetricHistory,
  withMetricStore,
} from './media-metrics-test-helpers.js';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { RequestMediaResolver } from './request-media-resolver.js';

const REQUEST_BUDGET = 8 * 1024 * 1024;

describe('media metrics and real ownership', () => {
  it('does not reserve media or emit history events and counts removed media independently from spool', async () => {
    await withMetricStore(async (store) => {
      const first = await store.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/wav',
        semanticMetadata: {},
      });
      const second = await store.admit({
        bytes: new Uint8Array([4, 5, 6, 7]),
        mimeType: 'audio/wav',
        semanticMetadata: {},
      });
      const history = new StreamMetricHistory();
      history.registerMediaOwner(new HistoryMediaOwnership(store));
      const resolver = new RequestMediaResolver(store);
      const metrics = new MediaLifecycleMetrics({
        ...metricSources(store, history),
        requestResolver: resolver,
      });
      try {
        await history.replaceAll([
          { speaker: 'human', blocks: [first, first, second] },
        ]);
        await history.waitForTokenUpdates();
        let tokenEvents = 0;
        history.on('tokensUpdated', () => {
          tokenEvents++;
        });
        const before = await metrics.snapshot();
        expect(before.localRetainedBlobBytes).toBe(7);
        expect(before.diskSpoolBytes).toBe(7);
        expect(tokenEvents).toBe(0);
        expect(await store.hasReservations(first.contentId)).toBe(true);
        const resolved = await resolver.resolve({
          contents: [{ speaker: 'human', blocks: [first, first, second] }],
          requestId: 'owner-metric',
          turnId: 'owner-turn',
          aggregateBudgetBytes: REQUEST_BUDGET,
        });
        try {
          const active = await metrics.snapshot();
          expect(active.activeRequestMaterializationBytes).toBe(12);
          expect(active.localRetainedBlobBytes).toBe(7);
        } finally {
          await resolved.release();
        }
        await history.replaceAll([{ speaker: 'human', blocks: [second] }]);
        const removed = await metrics.snapshot();
        expect(removed.localRetainedBlobBytes).toBe(4);
        expect(removed.diskSpoolBytes).toBe(7);
        expect(await store.hasReservations(first.contentId)).toBe(false);
        await history.replaceAll([]);
        const empty = await metrics.snapshot();
        expect(
          empty.localRetainedBlobBytes +
            empty.residentEncodedBytes +
            empty.activeRequestMaterializationBytes,
        ).toBe(0);
        expect(empty.diskSpoolBytes).toBe(7);
        expect(await store.hasReservations(second.contentId)).toBe(false);
      } finally {
        history.dispose();
      }
    });
  });
});
