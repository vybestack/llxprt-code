/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withPendingFixture,
  pendingCaller,
  pendingGate,
  type PendingFixture,
} from './pending-window-disk-helpers.js';
import { collectRawHistory } from '../../../../core/src/test-utils/collect-raw-history.js';
import { mediaParticipant } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';

function pausePublication(history: PendingFixture['history']): {
  publishing: ReturnType<typeof pendingGate>;
  publish: ReturnType<typeof pendingGate>;
} {
  const publishing = pendingGate();
  const publish = pendingGate();
  history.registerMediaOwner(
    mediaParticipant((input) => ({
      rollback: () => {},
      publish: async () => {
        for (const _row of input.next) {
          publishing.resolve();
          await publish.promise;
          break;
        }
      },
    })),
  );
  return { publishing, publish };
}

async function membershipDifference(
  history: PendingFixture['history'],
  before: Awaited<ReturnType<typeof collectRawHistory>>,
): Promise<number> {
  return Buffer.compare(
    Buffer.from(JSON.stringify(await collectRawHistory(history))),
    Buffer.from(JSON.stringify(before)),
  );
}
async function phases(size: number): Promise<number> {
  return withPendingFixture(
    size,
    async ({
      history,
      recorder,
      owners,
      setup,
      pauseWriter,
      releaseWriter,
    }) => {
      pauseWriter();
      const callers = [pendingCaller(0), pendingCaller(1)];
      history.add(callers[0]);
      history.add(callers[1]);
      await history.waitForTokenUpdates();
      const before = await collectRawHistory(history);
      const markers = callers.map((row) => row.metadata?.chronology);
      const preparing = pendingGate();
      const prepare = pendingGate();
      setup.handler.setActiveTodosProvider(async () => {
        preparing.resolve();
        await prepare.promise;
        return 'todo';
      });
      const { publishing, publish } = pausePublication(history);
      history.startCompression();
      const operation = setup.handler.enforceContextWindow(
        600,
        'pending-phases',
      );
      await preparing.promise;
      const queuedBefore = pendingCaller(2);
      history.add(queuedBefore);
      expect(await membershipDifference(history, before)).toBe(0);
      expect(queuedBefore.metadata?.chronology).toBeUndefined();
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      prepare.resolve();
      await publishing.promise;
      const queuedDuring = pendingCaller(3);
      history.add(queuedDuring);
      expect(await membershipDifference(history, before)).toBe(0);
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      publish.resolve();
      await operation;
      const installed = await collectRawHistory(history);
      expect(installed).toHaveLength(2);
      expect(installed[0]).toBe(callers[0]);
      expect(installed[1]).toBe(callers[1]);
      expect(installed.map((row) => row.metadata?.chronology)).toStrictEqual(
        markers,
      );
      expect(queuedDuring.metadata?.chronology).toBeUndefined();
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      history.endCompression();
      const unsettled = await collectRawHistory(history);
      expect(unsettled[2]).toBe(queuedBefore);
      expect(unsettled[3]).toBe(queuedDuring);
      releaseWriter();
      await recorder.flush();
      expect(await collectRawHistory(history)).toStrictEqual([
        ...callers,
        queuedBefore,
        queuedDuring,
      ]);
      expect(owners.snapshot().liveRows).toBe(0);
      return unsettled.length;
    },
  );
}
describe('pending-window paused ownership phases', () => {
  it.each([512, 8192])(
    'preserves %i-row membership before preparation, during publication and after enforcement',
    async (size) => {
      expect(await phases(size)).toBeGreaterThan(0);
    },
    180000,
  );
});
