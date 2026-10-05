/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { cleanupExpiredSessions } from './sessionCleanup.js';
import {
  cleanupBounds,
  expectedCleanupDigest,
  mediaObjectPath,
  recordCleanupOwners,
  withCleanupHistory,
} from './cleanup-history-test-helpers.js';

for (const size of [512, 8192]) {
  for (const active of [false, true]) {
    describe(`CLI cleanup ${active ? 'active' : 'inactive'} history at ${size}`, () => {
      it('preserves original and selected media from the complete pinned stream and reclaims only the orphan', async () => {
        await withCleanupHistory(size, active, async (fixture) => {
          const { config, history, reader, store, reference, orphan, root } =
            fixture;
          const tokensBefore = config
            .getAgentClient()
            .getHistoryService()
            ?.getTotalTokens();
          const result = await cleanupExpiredSessions(config, {}, root);
          recordCleanupOwners(size, active, 'settled', fixture);
          expect({
            failed: result.failed,
            wonLease: result.janitorWonLease,
          }).toStrictEqual({ failed: 0, wonLease: true });
          expect(history.delivered).toBe(size);
          expect(history.digest).toBe(
            expectedCleanupDigest(size, 2048, reference),
          );
          expect(fixture.decoded()).toBe(size);
          expect(history.opened).toBe(1);
          expect(history.closed).toBe(1);
          expect(reader.within(cleanupBounds)).toBe(true);
          expect(reader.snapshot().liveRows).toBe(0);
          expect(
            config.getAgentClient().getHistoryService()?.getTotalTokens(),
          ).toBe(tokensBefore);
          expect(
            await readFile(mediaObjectPath(store, reference.originalContentId)),
          ).toStrictEqual(Buffer.from([1, 2, 3, 4]));
          expect(
            await readFile(mediaObjectPath(store, reference.selectedContentId)),
          ).toStrictEqual(Buffer.from([5, 6, 7, 8]));
          await expect(
            stat(mediaObjectPath(store, orphan.contentId)),
          ).rejects.toMatchObject({ code: 'ENOENT' });
          const cursor = config.getAgentClient().streamHistory();
          expect((await cursor.next()).done).toBe(false);
          await cursor.return();
          expect({
            closed: (await cursor.next()).done,
            liveRows: reader.snapshot().liveRows,
          }).toStrictEqual({ closed: true, liveRows: 0 });
        });
      }, 180_000);

      it('closes a failing history source before any media deletion and keeps the configured result budget', async () => {
        await withCleanupHistory(size, active, async (fixture) => {
          fixture.history.failAt = 2;
          const result = await cleanupExpiredSessions(
            fixture.config,
            {},
            fixture.root,
          );
          recordCleanupOwners(size, active, 'source-fault', fixture);
          expect({
            failed: result.failed,
            wonLease: result.janitorWonLease,
            limit: result.configuredByteLimit,
          }).toStrictEqual({
            failed: 1,
            wonLease: true,
            limit: 4096 * 1024 * 1024,
          });
          expect(fixture.history.delivered).toBe(2);
          expect(fixture.history.closed).toBe(1);
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          expect(
            await stat(
              mediaObjectPath(fixture.store, fixture.orphan.contentId),
            ),
          ).toMatchObject({ size: 4 });
          expect(
            await stat(
              mediaObjectPath(fixture.store, fixture.reference.contentId),
            ),
          ).toMatchObject({ size: 4 });
        });
      }, 180_000);
    });
  }
}

describe('CLI cleanup oversized valid rows', () => {
  for (const active of [false, true]) {
    it(`accepts one valid nine-MiB row through ${active ? 'active' : 'inactive'} CLI cleanup`, async () => {
      const bytes = 9 * 1024 * 1024;
      await withCleanupHistory(
        1,
        active,
        async (fixture) => {
          const result = await cleanupExpiredSessions(
            fixture.config,
            {},
            fixture.root,
          );
          recordCleanupOwners(1, active, 'valid-nine-MiB', fixture);
          expect(result.failed).toBe(0);
          expect(fixture.history.digest).toBe(
            expectedCleanupDigest(1, bytes, fixture.reference),
          );
          expect(fixture.decoded()).toBe(1);
          expect(fixture.reader.snapshot().peakRows).toBe(1);
          expect(fixture.reader.snapshot().peakSerializedBytes).toBeGreaterThan(
            bytes,
          );
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          await expect(
            stat(mediaObjectPath(fixture.store, fixture.orphan.contentId)),
          ).rejects.toMatchObject({ code: 'ENOENT' });
        },
        bytes,
      );
    }, 180_000);
  }
});
