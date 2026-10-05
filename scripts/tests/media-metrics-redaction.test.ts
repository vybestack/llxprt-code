/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import {
  metricReference,
  metricRow,
  metricSources,
  StreamMetricHistory,
  withMetricStore,
} from '../../packages/core/src/storage/media-metrics-test-helpers.js';
import { MediaLifecycleMetrics } from '../../packages/core/src/storage/media-lifecycle-metrics.js';
import { sanitizeDiagnosticData } from '../../packages/providers/src/utils/mediaDiagnostics.js';

function expectedDiagnostic(index: number): object {
  const row = metricRow(index);
  const reference = (id: number): object => ({
    contentId: metricReference(id).contentId,
    byteCount: 16,
    mimeType: 'image/png',
    transportMode: 'full',
  });
  return {
    ...row,
    blocks: [
      row.blocks[0],
      reference(index),
      reference(Math.floor(index / 2)),
      {
        contentId: `sha256:${createHash('sha256').update('hello').digest('hex')}`,
        byteCount: 5,
        mimeType: 'audio/wav',
        transportMode: 'full',
      },
      { mimeType: 'image/png', transportMode: 'url' },
      row.blocks[5],
      row.blocks[6],
    ],
  };
}

for (const size of [512, 8192])
  describe(`media metrics redaction ${size}`, () => {
    it('preserves independent redacted diagnostic bytes without exposing inline payloads', async () => {
      await withMetricStore(async (store) =>
        withSuffixFixture(
          size,
          async (history, owners) => {
            await new MediaLifecycleMetrics(
              metricSources(store, history),
            ).snapshot();
            const actual = createHash('sha256');
            const expected = createHash('sha256');
            let index = 0;
            for await (const row of history.streamRawHistory()) {
              const serialized = JSON.stringify(sanitizeDiagnosticData(row));
              actual.update(serialized + '\n');
              expected.update(
                JSON.stringify(expectedDiagnostic(index++)) + '\n',
              );
              expect(serialized).not.toContain('aGVsbG8=');
              expect(serialized).not.toContain('fixture.invalid');
            }
            expect(index).toBe(size);
            expect(actual.digest('hex')).toBe(expected.digest('hex'));
            expect(owners.snapshot().liveRows).toBe(0);
          },
          20_000,
          metricRow,
          undefined,
          (journal) => new StreamMetricHistory(journal),
        ),
      );
    }, 120_000);
  });
