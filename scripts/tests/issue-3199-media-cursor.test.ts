/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  StreamMetricHistory,
  metricReference,
  withMetricStore,
} from '../../packages/core/src/storage/media-metrics-test-helpers.js';
import { MediaAdmissionService } from '../../packages/core/src/storage/media-admission-service.js';
import { RequestMediaResolver } from '../../packages/core/src/storage/request-media-resolver.js';
import { mediaProbeImageBytes } from '../issue-3199-media-memory-benchmark.js';
import { resolveMediaProbeHistory } from '../issue-3199-media-memory-resolution.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

function expectedProbeSerialization(
  admitted: IContent,
  encoded: string,
): string {
  return JSON.stringify([
    {
      ...admitted,
      blocks: [
        { type: 'text', text: 'Equivalent image-heavy probe turn 1' },
        {
          type: 'media',
          encoding: 'base64',
          data: encoded,
          mimeType: 'image/png',
          dimensions: { width: 1, height: 1 },
          semanticMetadata: {},
        },
      ],
    },
  ]);
}

const options = {
  requestId: 'cursor-probe',
  turnId: 'probe-turn',
  aggregateBudgetBytes: 8 * 1024 * 1024,
};

describe('issue 3199 admitted-row cursor resolution', () => {
  it('resolves the pinned admitted row with real reservations, inline bytes and release', async () => {
    await withMetricStore(async (store) => {
      const bytes = mediaProbeImageBytes(1, 512 * 1024);
      const encoded = Buffer.from(bytes).toString('base64');
      const admitted = await new MediaAdmissionService(store).admitContent(
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'Equivalent image-heavy probe turn 1' },
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'image/png',
              data: encoded,
            },
          ],
          metadata: { turnId: 'probe-turn' },
        },
        { turnId: 'probe-turn', source: 'media-memory-probe' },
      );
      await withSuffixFixture(
        1,
        async (history, owners) => {
          const resolver = new RequestMediaResolver(store);
          const resolved = await resolveMediaProbeHistory(
            history.streamRawHistory(),
            resolver,
            options,
          );
          try {
            expect(resolved.accounting()).toMatchObject({
              selectedReferenceCount: 1,
              uniqueContentCount: 1,
              selectedNormalizedBytes: encoded.length,
              materializedNormalizedBytes: encoded.length,
              storeReadCount: 1,
              reservedContentCount: 1,
            });
            const serialized = resolved.withContents((rows) =>
              JSON.stringify(rows),
            );
            const expected = expectedProbeSerialization(admitted, encoded);
            expect(createHash('sha256').update(serialized).digest('hex')).toBe(
              createHash('sha256').update(expected).digest('hex'),
            );
            expect(serialized).not.toContain('sourceContentId');
            expect(owners.snapshot().peakRows).toBe(1);
            expect(owners.snapshot().liveRows).toBe(0);
          } finally {
            await resolved.release();
          }
          expect(resolver.accounting()).toMatchObject({
            activeRequestCount: 0,
            reservedContentCount: 0,
            materializedNormalizedBytes: 0,
            storeReadCount: 1,
          });
        },
        0,
        () => admitted,
        undefined,
        (journal) => new StreamMetricHistory(journal),
      );
    });
  }, 120_000);
});

describe('issue 3199 media probe cursor failures', () => {
  it('rejects empty and multi-row probe workloads and releases a resolved request', async () => {
    await withMetricStore(async (store) => {
      for (const size of [0, 2])
        await withSuffixFixture(size, async (history, owners) => {
          const resolver = new RequestMediaResolver(store);
          await expect(
            resolveMediaProbeHistory(
              history.streamRawHistory(),
              resolver,
              options,
            ),
          ).rejects.toThrow('exactly one');
          expect(resolver.accounting().activeRequestCount).toBe(0);
          expect(owners.snapshot().liveRows).toBe(0);
        });
    });
  });

  it('rejects missing blobs through the real resolver and releases the cursor', async () => {
    await withMetricStore(async (store) =>
      withSuffixFixture(
        1,
        async (history, owners) => {
          const resolver = new RequestMediaResolver(store);
          await expect(
            resolveMediaProbeHistory(
              history.streamRawHistory(),
              resolver,
              options,
            ),
          ).rejects.toThrow('blob verification');
          expect(resolver.accounting()).toMatchObject({
            activeRequestCount: 0,
            reservedContentCount: 0,
            materializedNormalizedBytes: 0,
            storeReadCount: 1,
          });
          expect(owners.snapshot().liveRows).toBe(0);
        },
        0,
        () => ({ speaker: 'human', blocks: [metricReference(0)] }),
      ),
    );
  });

  it('rejects aborted cursor reads without active owners', async () => {
    await withMetricStore(async (store) =>
      withSuffixFixture(1, async (history, owners) => {
        const resolver = new RequestMediaResolver(store);
        const abort = new AbortController();
        abort.abort(new Error('probe aborted'));
        await expect(
          resolveMediaProbeHistory(
            history.streamRawHistory(abort.signal),
            resolver,
            { ...options, signal: abort.signal },
          ),
        ).rejects.toThrow();
        expect(resolver.accounting().activeRequestCount).toBe(0);
        expect(owners.snapshot().liveRows).toBe(0);
      }),
    );
  });
});
