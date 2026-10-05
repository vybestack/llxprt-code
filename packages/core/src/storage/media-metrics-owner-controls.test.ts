/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '../services/history/IContent.js';
import { RowOwnership } from '../recording/rowOwnership.js';
import { withSuffixFixture } from '../services/history/history-suffix-test-helpers.js';
import { MediaLifecycleMetrics } from './media-lifecycle-metrics.js';
import {
  metricRow,
  metricSources,
  StreamMetricHistory,
  withMetricStore,
} from './media-metrics-test-helpers.js';

class RetainingMetricHistory extends StreamMetricHistory {
  readonly retained = new RowOwnership();
  private held: IContent[] = [];

  constructor(
    private readonly copy: boolean,
    ...args: ConstructorParameters<typeof StreamMetricHistory>
  ) {
    super(...args);
  }

  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of super.streamRawHistory(signal)) {
      const held = this.copy ? { ...row, blocks: [...row.blocks] } : row;
      this.retained.retain(held);
      this.held.push(held);
      yield row;
    }
  }

  releaseRetained(): void {
    for (const row of this.held) this.retained.release(row);
    this.held = [];
  }
}

for (const size of [512, 8192])
  for (const copy of [false, true]) {
    describe(`media metric retaining consumer ${size} copy=${copy}`, () => {
      it('detects strong borrowed and copied retention beyond unchanged controlled bounds', async () => {
        let retaining: RetainingMetricHistory | undefined;
        await withMetricStore(async (store) =>
          withSuffixFixture(
            size,
            async (history, reader) => {
              if (retaining === undefined)
                throw new Error('Missing retaining fixture');
              try {
                const snapshot = await new MediaLifecycleMetrics(
                  metricSources(store, history),
                ).snapshot();
                expect(snapshot.localRetainedBlobBytes).toBe(size * 16);
                expect(reader.snapshot().liveRows).toBe(0);
                expect(retaining.retained.snapshot().liveRows).toBe(size);
                expect(retaining.retained.snapshot().peakRows).toBeGreaterThan(
                  440,
                );
                expect(
                  retaining.retained.snapshot().peakSerializedBytes,
                ).toBeGreaterThan(8 * 1024 * 1024);
                expect(
                  retaining.retained.within({
                    rows: 440,
                    serializedBytes: 8 * 1024 * 1024,
                  }),
                ).toBe(process.env['MEDIA_METRIC_RETAINING_TRAP'] === '1');
              } finally {
                retaining.releaseRetained();
              }
              expect(retaining.retained.snapshot().liveRows).toBe(0);
              expect(retaining.retained.snapshot().liveSerializedBytes).toBe(0);
            },
            20_000,
            metricRow,
            undefined,
            (options) => {
              retaining = new RetainingMetricHistory(copy, options);
              return retaining;
            },
          ),
        );
      }, 120_000);
    });
  }
