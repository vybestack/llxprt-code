/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { mediaParticipant } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { batchRow } from '../../../../core/src/services/history/addbatch-stream-test-helpers.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  pendingCaller,
  pendingGate,
  withPendingFixture,
} from './pending-window-disk-helpers.js';

function recordCensus(size: number, owners: RowOwnership): void {
  const output = process.env.ADDBATCH_PENDING_OWNER_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      `${JSON.stringify({ size, census: owners.snapshot() })}\n`,
    );
}

async function pendingBatch(size: number): Promise<void> {
  await withPendingFixture(
    size,
    async ({
      history,
      recorder,
      owners,
      setup,
      pauseWriter,
      releaseWriter,
    }) => {
      const batch = Array.from({ length: size }, (_, index) =>
        batchRow(size + index),
      );
      await history.addBatch(batch, undefined, { streamPublication: true });
      await history.waitForCommit();
      expect(batch).toHaveLength(size);
      pauseWriter();
      const callers = [pendingCaller(0), pendingCaller(1)];
      history.add(callers[0]);
      history.add(callers[1]);
      const markers = callers.map((row) => row.metadata?.chronology);
      history.startCompression();
      const queued = pendingCaller(2);
      history.add(queued);
      const ready = pendingGate();
      const gate = pendingGate();
      history.registerMediaOwner(
        mediaParticipant((input) => ({
          rollback: () => {},
          publish: async () => {
            for (const _row of input.next) {
              ready.resolve();
              await gate.promise;
              break;
            }
          },
        })),
      );
      const operation = setup.handler.enforceContextWindow(
        600,
        'addbatch-pending-window',
      );
      await ready.promise;
      try {
        expect(owners.snapshot().liveRows).toBeGreaterThan(0);
        expect(owners.snapshot().liveRows).toBeLessThanOrEqual(440);
        expect(owners.snapshot().liveSerializedBytes).toBeLessThanOrEqual(
          8 * 1024 * 1024,
        );
        expect(queued.metadata?.chronology).toBeUndefined();
      } finally {
        gate.resolve();
      }
      await operation;
      const installed = await collectRawHistory(history);
      expect(installed).toStrictEqual(callers);
      for (let index = 0; index < callers.length; index++) {
        expect(installed[index]).toBe(callers[index]);
        expect(installed[index].metadata?.chronology).toBe(markers[index]);
      }
      history.endCompression();
      const queuedRows = await collectRawHistory(history);
      expect(queuedRows[queuedRows.length - 1]).toBe(queued);
      // The writer has remained blocked through publication and queued replay.
      releaseWriter();
      await recorder.flush();
      expect(owners.snapshot().liveRows).toBe(0);
      expect(await collectRawHistory(history)).toStrictEqual([
        ...callers,
        queued,
      ]);
      recordCensus(size, owners);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
    },
  );
}

/** Caller identity and rollback pins remain charged even when the external
 * caller holds the complete batch. The aggregate acceptance check stays RED.
 */
describe('addBatch followed by the actual paused pending-window route', () => {
  it.each([512, 8192])(
    'preserves %i accepted external rows and completes fallback before writer release',
    async (size) => {
      await expect(pendingBatch(size)).resolves.toBeUndefined();
    },
    180000,
  );
});
