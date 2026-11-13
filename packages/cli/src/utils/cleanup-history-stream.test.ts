/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { cleanupExpiredSessions } from './sessionCleanup.js';
import {
  cleanupRow,
  expectedCleanupDigest,
  mediaObjectPath,
  recordCleanupOwners,
  withCleanupHistory,
} from './__tests__/support/cleanup-history-test-helpers.js';

function cleanupAllowance(
  size: number,
  bytes: number,
  reference: Parameters<typeof cleanupRow>[3],
): {
  total: number;
  largest: number;
  bounds: { rows: number; serializedBytes: number };
} {
  let total = 0;
  let largest = 0;
  for (let index = 0; index < size; index++) {
    const serialized = Buffer.byteLength(
      JSON.stringify(cleanupRow(index, bytes, size, reference)),
    );
    total += serialized;
    largest = Math.max(largest, serialized);
  }
  // The ownership census charges one UTF-8 JSON row, without heap overhead.
  return { total, largest, bounds: { rows: 1, serializedBytes: largest } };
}

for (const size of [65]) {
  for (const active of [false, true]) {
    describe(`CLI cleanup ${active ? 'active' : 'inactive'} history at ${size}`, () => {
      it('preserves original and selected media from the complete pinned stream and reclaims only the orphan', async () => {
        await withCleanupHistory(size, active, async (fixture) => {
          const { config, history, reader, store, reference, orphan, root } =
            fixture;
          const tokensBefore = fixture.client
            .getHistoryService()
            ?.getTotalTokens();
          const result = await cleanupExpiredSessions(
            config,
            {},
            root,
            undefined,
            fixture.readActiveHistory,
          );
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
          const allowance = cleanupAllowance(size, 2048, reference);
          expect(reader.within(allowance.bounds)).toBe(true);
          expect(allowance.total).toBeGreaterThan(
            4 * allowance.bounds.serializedBytes,
          );
          process.stdout.write(
            `CLEANUP_BYTES ${JSON.stringify({ active, ...allowance, ...reader.snapshot() })}\n`,
          );
          expect(reader.snapshot().liveRows).toBe(0);
          expect(fixture.client.getHistoryService()?.getTotalTokens()).toBe(
            tokensBefore,
          );
          expect(
            await readFile(mediaObjectPath(store, reference.originalContentId)),
          ).toStrictEqual(Buffer.from([1, 2, 3, 4]));
          expect(
            await readFile(mediaObjectPath(store, reference.selectedContentId)),
          ).toStrictEqual(Buffer.from([5, 6, 7, 8]));
          await expect(
            stat(mediaObjectPath(store, orphan.contentId)),
          ).rejects.toMatchObject({ code: 'ENOENT' });
          const cursor = fixture.client.streamHistory();
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
            undefined,
            fixture.readActiveHistory,
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

describe('CLI cleanup ownership controls', () => {
  for (const active of [false, true]) {
    it.each(['borrowed', 'copy'])(
      'rejects retaining the same streamed rows, mode=%s',
      async (mode) => {
        await withCleanupHistory(65, active, async (fixture) => {
          fixture.history.retaining = mode;
          const result = await cleanupExpiredSessions(
            fixture.config,
            {},
            fixture.root,
            undefined,
            fixture.readActiveHistory,
          );
          expect(result.failed).toBe(0);
          const allowance = cleanupAllowance(65, 2048, fixture.reference);
          expect(fixture.history.external.within(allowance.bounds)).toBe(false);
          expect(
            fixture.history.external.snapshot().peakSerializedBytes,
          ).toBeGreaterThan(3 * allowance.bounds.serializedBytes);
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          process.stdout.write(
            `CLEANUP_CONTROL ${JSON.stringify({ active, mode, ...allowance, ...fixture.history.external.snapshot() })}\n`,
          );
          fixture.history.releaseExternal();
          expect(fixture.history.external.snapshot().liveRows).toBe(0);
        });
      },
      180_000,
    );
  }
});

describe('CLI cleanup oversized valid rows', () => {
  for (const active of [false, true]) {
    it(`accepts one valid 128-KiB row through ${active ? 'active' : 'inactive'} CLI cleanup`, async () => {
      const bytes = 128 * 1024;
      await withCleanupHistory(
        1,
        active,
        async (fixture) => {
          const result = await cleanupExpiredSessions(
            fixture.config,
            {},
            fixture.root,
            undefined,
            fixture.readActiveHistory,
          );
          recordCleanupOwners(1, active, 'valid-128-KiB', fixture);
          expect(result.failed).toBe(0);
          expect(fixture.history.digest).toBe(
            expectedCleanupDigest(1, bytes, fixture.reference),
          );
          expect(fixture.decoded()).toBe(1);
          expect(fixture.reader.snapshot().peakRows).toBeLessThanOrEqual(1);
          expect(fixture.reader.snapshot().peakSerializedBytes).toBeGreaterThan(
            bytes,
          );
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          expect(
            fixture.reader.within(
              cleanupAllowance(1, bytes, fixture.reference).bounds,
            ),
          ).toBe(true);
          await expect(
            stat(mediaObjectPath(fixture.store, fixture.orphan.contentId)),
          ).rejects.toMatchObject({ code: 'ENOENT' });
        },
        bytes,
      );
    }, 180_000);
  }
});
