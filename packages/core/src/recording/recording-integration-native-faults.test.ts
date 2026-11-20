/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  nativeText,
  useNativeIntegration,
  type NativeIntegrationFixture,
} from './__tests__/support/native-integration-fixture.js';
import { RecordingFailureReport } from './recording-failure-report.js';
async function heldWrite(fixture: NativeIntegrationFixture): Promise<void> {
  const index = fixture.failures.gateWriteAt;
  if (index === undefined) throw new Error('No native write gate armed');
  while (
    fixture.seams.events.filter((event) => event.type === 'write').length <=
    index
  )
    await new Promise<void>((resolve) => setImmediate(resolve));
}

async function rejected(operation: Promise<void>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected native operation to reject');
}

async function reportOf(
  operation: Promise<void>,
  generation: number,
): Promise<unknown> {
  const failure = await rejected(operation);
  if (!(failure instanceof RecordingFailureReport)) throw failure;
  expect(failure.count).toBe(1);
  let failures = 0;
  for await (const detail of failure.details()) {
    if (detail.kind !== 'failure') continue;
    expect(detail.generation).toBe(generation);
    failures++;
  }
  expect(failures).toBe(1);
  return failure.cause;
}

describe('native recording integration writer and owner contracts', () => {
  const fixture = useNativeIntegration();

  it('does not cross the turn boundary until a held mirror write is durable', async () => {
    const { history, integration, seams, failures, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('before'));
    await integration.flushAtTurnBoundary();
    failures.gateWriteAt = seams.events.filter(
      (event) => event.type === 'write',
    ).length;
    history.add(nativeText('after'));
    let settled = false;
    const boundary = integration.flushAtTurnBoundary().then(() => {
      settled = true;
    });
    try {
      await heldWrite(fixture());
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(await texts()).toStrictEqual(['before']);
    } finally {
      seams.release();
    }
    await boundary;
    expect(await texts()).toStrictEqual(['before', 'after']);
  });

  it('joins an admitted native row before disposal and detaches later additions', async () => {
    const { history, integration, seams, failures, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('before'));
    await integration.flushAtTurnBoundary();
    failures.gateWriteAt = seams.events.filter(
      (event) => event.type === 'write',
    ).length;
    history.add(nativeText('admitted'));
    let settled = false;
    const disposal = integration.dispose();
    expect(new Set([disposal, integration.dispose()]).size).toBe(1);
    const observed = disposal.then(() => {
      settled = true;
    });
    try {
      await heldWrite(fixture());
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      seams.release();
    }
    await observed;
    history.add(nativeText('after-dispose'));
    await history.waitForCommit();
    expect(await texts()).toStrictEqual(['before', 'admitted']);
  });

  it('restores the durable mirror when a batch publication listener rejects', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('baseline'));
    await integration.flushAtTurnBoundary();
    const failure = new Error('native batch listener rejected');
    history.on('contentBatchAdded', () => {
      throw failure;
    });
    await expect(
      history.addBatch([nativeText('first'), nativeText('second', 'ai')]),
    ).rejects.toBe(failure);
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['baseline']);
    expect(history.getStatistics().totalMessages).toBe(1);
  });

  it('persists clear and a following addition without resurrecting prior rows', async () => {
    const { history, integration, texts } = fixture();
    await integration.subscribeToJournal(history);
    await history.addBatch([nativeText('first'), nativeText('second', 'ai')]);
    await history.clear();
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual([]);
    history.add(nativeText('after clear'));
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual(['after clear']);
    expect(history.getContextRange().totalEntries).toBe(1);
  });

  for (const kind of ['write', 'flush'] as const) {
    it(`reports an actual positional ${kind} failure without claiming the rejected row durable`, async () => {
      const { history, integration, seams, failures, texts } = fixture();
      await integration.subscribeToJournal(history);
      history.add(nativeText('baseline'));
      await integration.flushAtTurnBoundary();
      const count = seams.events.filter((event) => event.type === kind).length;
      if (kind === 'write') failures.failWriteAt = count;
      else failures.failFlushAt = count;
      history.add(nativeText('failed row'));
      const cause = await reportOf(integration.flushAtTurnBoundary(), 2);
      expect(cause).toBeInstanceOf(Error);
      expect(cause).toHaveProperty('message', `injected ${kind} failure`);
      expect(await texts()).toStrictEqual(['baseline']);
      const repeated = await reportOf(integration.flushAtTurnBoundary(), 3);
      expect(repeated).toBe(cause);
      await expect(integration.dispose()).resolves.toBeUndefined();
      expect(await texts()).toStrictEqual(['baseline']);
    });
  }
});
