/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import {
  createCursorPersistence,
  seedCursorPersistence,
} from '../../packages/core/src/storage/cursor-persistence-test-helpers.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { withMetricStore } from '../../packages/core/src/storage/media-metrics-test-helpers.js';
import { MediaAdmissionService } from '../../packages/core/src/storage/media-admission-service.js';
import { mediaProbeImageBytes } from '../issue-3199-media-memory-benchmark.js';
import {
  saveMediaProbeHistory,
  countMediaProbeHistory,
} from '../issue-3199-media-memory-persistence.js';
import {
  MergeRowHistory,
  mergeRow,
} from '../../packages/core/src/services/history/history-merge-test-helpers.js';
describe('media probe persistence cursor', () => {
  it('persists the accepted admitted row, counts with a scalar and releases save reservations', async () => {
    await withMetricStore(async (store) => {
      const admitted = await new MediaAdmissionService(store).admitContent(
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'image/png',
              data: Buffer.from(mediaProbeImageBytes(1, 512 * 1024)).toString(
                'base64',
              ),
            },
          ],
          metadata: { turnId: 'save-probe' },
        },
        { turnId: 'save-probe', source: 'media-memory-probe' },
      );
      await withSuffixFixture(
        1,
        async (history, owners) => {
          const persistence = createCursorPersistence(history, 'save-probe', {
            mediaStore: store,
            maxQueueBytes: 8 * 1024 * 1024,
          });
          const saved = await saveMediaProbeHistory(history, persistence);
          expect(saved).toBe(1);
          expect(await countMediaProbeHistory(history)).toBe(1);
          const session: unknown = JSON.parse(
            await readFile(persistence.getSessionFilePath(), 'utf8'),
          );
          expect(session).toMatchObject({
            history: [admitted],
            sessionId: 'save-probe',
          });
          expect(persistence.getPendingByteCount()).toBe(0);
          expect(owners.snapshot().peakRows).toBe(1);
          expect(owners.snapshot().liveRows).toBe(0);
        },
        0,
        () => admitted,
        undefined,
        (options) => new MergeRowHistory(options),
      );
    });
  }, 120_000);

  it('rejects empty and multi-row probe saves without replacing the previous target', async () => {
    await withSuffixFixture(1, async (history) => {
      const persistence = createCursorPersistence(history, 'atomic-probe');
      const before = await seedCursorPersistence(persistence, mergeRow(30));
      for (const size of [0, 2])
        await withSuffixFixture(size, async (badHistory) => {
          await expect(
            saveMediaProbeHistory(badHistory, persistence),
          ).rejects.toThrow('exactly one');
          expect(await readFile(persistence.getSessionFilePath(), 'utf8')).toBe(
            before,
          );
          expect(persistence.getPendingByteCount()).toBe(0);
        });
      expect(
        (await readdir(persistence.getChatsDir())).filter((name) =>
          name.endsWith('.tmp'),
        ),
      ).toStrictEqual([]);
    });
  });
});
