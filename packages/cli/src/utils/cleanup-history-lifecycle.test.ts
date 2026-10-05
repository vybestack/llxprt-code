/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { stat } from 'node:fs/promises';
import { JanitorLease } from '@vybestack/llxprt-code-core/recording/janitor/janitorLease.js';
import { cleanupExpiredSessions } from './sessionCleanup.js';
import {
  cleanupBounds,
  mediaObjectPath,
  recordCleanupOwners,
  withCleanupHistory,
} from './cleanup-history-test-helpers.js';

const retainingModes: ReadonlyArray<'borrowed' | 'copy'> = ['borrowed', 'copy'];

for (const size of [512, 8192]) {
  for (const active of [false, true]) {
    describe(`CLI cleanup lifecycle ${active ? 'active' : 'inactive'} at ${size}`, () => {
      it('keeps one paused source row without read-ahead, then aborts and closes before deleting media', async () => {
        await withCleanupHistory(size, active, async (fixture) => {
          fixture.history.pauseAt = 1;
          const controller = new AbortController();
          const cleaning = cleanupExpiredSessions(
            fixture.config,
            {},
            fixture.root,
            controller.signal,
          );
          const outcome = await Promise.race([
            fixture.history.paused.promise.then(() => 'paused'),
            cleaning.then(() => 'finished'),
          ]);
          try {
            expect(outcome).toBe('paused');
            recordCleanupOwners(size, active, 'paused', fixture);
            expect(fixture.decoded()).toBe(1);
            expect(fixture.reader.snapshot().liveRows).toBe(1);
            expect(fixture.reader.within(cleanupBounds)).toBe(true);
            controller.abort(new Error('cancel cleanup'));
          } finally {
            fixture.history.resume.resolve();
          }
          const result = await cleaning;
          recordCleanupOwners(size, active, 'aborted', fixture);
          expect(result.failed).toBe(1);
          expect(result.janitorWonLease).toBe(true);
          expect(fixture.history.closed).toBe(1);
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          expect(
            await stat(
              mediaObjectPath(fixture.store, fixture.orphan.contentId),
            ),
          ).toMatchObject({ size: 4 });
          const lease = await JanitorLease.tryAcquire(fixture.root);
          expect(lease).not.toBeNull();
          await lease?.release();
        });
      }, 180_000);

      for (const retaining of retainingModes) {
        it(`detects ${retaining} retaining consumers against the unchanged positive bounds`, async () => {
          await withCleanupHistory(size, active, async (fixture) => {
            fixture.history.retaining = retaining;
            const result = await cleanupExpiredSessions(
              fixture.config,
              {},
              fixture.root,
            );
            recordCleanupOwners(
              size,
              active,
              `retaining-${retaining}`,
              fixture,
            );
            expect(result.failed).toBe(0);
            expect(fixture.history.external.snapshot().peakRows).toBe(size);
            expect(fixture.history.external.within(cleanupBounds)).toBe(
              process.env.CLEANUP_HISTORY_RETAINING_TRAP === '1',
            );
            expect(
              fixture.history.external.snapshot().peakSerializedBytes >
                cleanupBounds.serializedBytes,
            ).toBe(size === 8192);
            expect(fixture.reader.snapshot().liveRows).toBe(0);
            fixture.history.releaseExternal();
            expect(fixture.history.external.snapshot().liveRows).toBe(0);
          });
        }, 180_000);
      }
    });
  }
}

describe('CLI cleanup cold source lifecycle', () => {
  it('does not open a cold history source when cleanup is disabled or another janitor holds the lease', async () => {
    await withCleanupHistory(2, false, async (fixture) => {
      const disabled = await cleanupExpiredSessions(
        fixture.config,
        { sessionRetention: { enabled: false } },
        fixture.root,
      );
      expect(disabled.disabled).toBe(true);
      expect(fixture.history.opened).toBe(0);
      const lease = await JanitorLease.tryAcquire(fixture.root);
      if (lease === null) throw new Error('Missing test lease');
      try {
        const busy = await cleanupExpiredSessions(
          fixture.config,
          {},
          fixture.root,
        );
        expect({
          wonLease: busy.janitorWonLease,
          failed: busy.failed,
          opened: fixture.history.opened,
          liveRows: fixture.reader.snapshot().liveRows,
        }).toStrictEqual({
          wonLease: false,
          failed: 0,
          opened: 0,
          liveRows: 0,
        });
      } finally {
        await lease.release();
      }
    });
  }, 180_000);

  it('does not decode a pre-aborted cleanup source or delete media', async () => {
    await withCleanupHistory(2, false, async (fixture) => {
      const controller = new AbortController();
      controller.abort(new Error('pre-abort cleanup'));
      const result = await cleanupExpiredSessions(
        fixture.config,
        {},
        fixture.root,
        controller.signal,
      );
      expect(result.failed).toBe(1);
      expect(fixture.decoded()).toBe(0);
      expect(fixture.history.opened).toBe(0);
      expect(fixture.reader.snapshot().liveRows).toBe(0);
      expect(
        await stat(mediaObjectPath(fixture.store, fixture.orphan.contentId)),
      ).toMatchObject({ size: 4 });
    });
  }, 180_000);
});
