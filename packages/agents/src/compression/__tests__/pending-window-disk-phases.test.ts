/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withPendingFixture,
  pendingCaller,
  pendingGate,
  pendingPublishedRows,
  type PendingFixture,
} from './pending-window-disk-helpers.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';

async function pausePublication(fixture: PendingFixture): Promise<{
  publishing: ReturnType<typeof pendingGate>;
  publish: ReturnType<typeof pendingGate>;
}> {
  const publishing = pendingGate();
  const publish = pendingGate();
  await fixture.pausePublication(publishing, publish);
  return { publishing, publish };
}

async function membershipDifference(
  fixture: PendingFixture,
  before: Awaited<ReturnType<typeof collectRawHistory>>,
): Promise<number> {
  return Buffer.compare(
    Buffer.from(JSON.stringify(await pendingPublishedRows(fixture))),
    Buffer.from(JSON.stringify(before)),
  );
}
async function phases(size: number): Promise<number> {
  return withPendingFixture(size, async (fixture) => {
    const { history, recorder, owners, setup } = fixture;
    const callers = [pendingCaller(0), pendingCaller(1)];
    history.add(callers[0]);
    history.add(callers[1]);
    await fixture.assertCommitted();
    const before = await collectRawHistory(history);
    const markers = callers.map((row) => row.metadata?.chronology);
    const preparing = pendingGate();
    const prepare = pendingGate();
    setup.handler.setActiveTodosProvider(async () => {
      preparing.resolve();
      await prepare.promise;
      return 'todo';
    });
    const { publishing, publish } = await pausePublication(fixture);
    history.startCompression();
    const operation = setup.handler.enforceContextWindow(600, 'pending-phases');
    await preparing.promise;
    const queuedBefore = pendingCaller(2);
    history.add(queuedBefore);
    expect(await membershipDifference(fixture, before)).toBe(0);
    expect(queuedBefore.metadata?.chronology).toBeUndefined();
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
    prepare.resolve();
    await publishing.promise;
    const queuedDuring = pendingCaller(3);
    history.add(queuedDuring);
    expect(await membershipDifference(fixture, before)).toBe(0);
    expect(owners.snapshot().liveRows).toBeGreaterThan(0);
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
    publish.resolve();
    await operation;
    const installed = await collectRawHistory(history);
    expect(installed).toHaveLength(2);
    expect(installed[0]).toStrictEqual(callers[0]);
    expect(installed[1]).toStrictEqual(callers[1]);
    expect(installed.map((row) => row.metadata?.chronology)).toStrictEqual(
      markers,
    );
    expect(queuedDuring.metadata?.chronology).toBeUndefined();
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
    history.endCompression();
    const unsettled = await collectRawHistory(history);
    expect(unsettled[2]).toStrictEqual(queuedBefore);
    expect(unsettled[3]).toStrictEqual(queuedDuring);
    await recorder.flush();
    expect(await collectRawHistory(history)).toStrictEqual([
      ...callers,
      queuedBefore,
      queuedDuring,
    ]);
    expect(owners.snapshot().liveRows).toBe(0);
    return unsettled.length;
  });
}
describe('pending-window ownership phases', () => {
  it.each([512, 8192])(
    'preserves %i-row membership before preparation, during publication and after enforcement',
    async (size) => {
      expect(await phases(size)).toBeGreaterThan(0);
    },
    180000,
  );
});
