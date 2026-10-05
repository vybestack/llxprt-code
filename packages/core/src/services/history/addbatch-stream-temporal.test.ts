/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { gcAndSweep } from 'bun:jsc';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import type { HistoryService } from './HistoryService.js';
import type { BatchOwnerCensus } from './addbatch-stream-test-helpers.js';

function submission(size: number): {
  rows: IContent[];
  weak: ReadonlyArray<WeakRef<object>>;
} {
  const rows = Array.from({ length: size }, (_, index) => batchRow(index));
  return {
    rows,
    weak: rows.flatMap((row) => {
      const marker = row.metadata?.chronology;
      if (marker === undefined) throw new Error('Missing test chronology');
      return [new WeakRef(row), new WeakRef(marker)];
    }),
  };
}

async function collected(
  probes: ReadonlyArray<WeakRef<object>>,
): Promise<number> {
  for (let index = 0; index < 8; index++) {
    await setImmediate();
    gcAndSweep();
  }
  await setImmediate();
  return probes.filter((probe) => probe.deref() !== undefined).length;
}

async function turns(): Promise<void> {
  for (let index = 0; index < 64; index++) await setImmediate();
}

async function nextTurns(operation: Promise<void>): Promise<boolean> {
  let settled = false;
  void operation.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await turns();
  return settled;
}

async function finalAdmission(): Promise<number> {
  return withBatchFixture(
    async ({
      history,
      owners,
      pauseWriter,
      waitForPausedWrite,
      releaseWriter,
    }) => {
      pauseWriter();
      const input = submission(1);
      owners.registerInput(input.rows);
      let observed = false;
      const operation = history.addBatch(input.rows, undefined, {
        streamPublication: true,
        afterPublication: () => {
          observed = true;
        },
      });
      input.rows = [];
      await waitForPausedWrite;
      expect(await nextTurns(operation)).toBe(true);
      await operation;
      expect(observed).toBe(true);
      expect(history.length()).toBe(1);
      expect(await collected(input.weak)).toBe(0);
      // Return is publication, not acknowledgement: pending values still own their charges.
      expect(owners.snapshot().liveRows).toBe(2);
      expect(owners.snapshot().liveRows).toBeLessThanOrEqual(440);
      expect(owners.snapshot().liveSerializedBytes).toBeLessThanOrEqual(
        8 * 1024 * 1024,
      );
      releaseWriter();
      await history.waitForCommit();
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().liveSerializedBytes).toBe(0);
      return history.length();
    },
  );
}

async function callbackCompensation(): Promise<number> {
  return withBatchFixture(
    async ({
      history,
      recorder,
      owners,
      pauseWriter,
      waitForPausedWrite,
      releaseWriter,
    }) => {
      await history.addBatch([batchRow(0)]);
      const baseline = await detachedDigest(
        (async function* (): AsyncGenerator<IContent, void, unknown> {
          yield batchRow(0);
        })(),
      );
      pauseWriter();
      const failure = new Error('published callback rejection');
      let published = false;
      const operation = history.addBatch([batchRow(1)], undefined, {
        streamPublication: true,
        afterPublication: () => {
          published = true;
          releaseWriter();
          throw failure;
        },
      });
      void operation.catch(() => undefined);
      await waitForPausedWrite;
      await turns();
      expect(published).toBe(true);
      await expect(operation).rejects.toBe(failure);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        baseline,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(baseline);
      expect(history.getTotalTokens()).toBe(4);
      expect(owners.snapshot().liveRows).toBe(0);
      return history.length();
    },
  );
}

async function explicitDurability(): Promise<number> {
  return withBatchFixture(
    async ({
      history,
      owners,
      pauseWriter,
      waitForPausedWrite,
      releaseWriter,
    }) => {
      pauseWriter();
      let published = false;
      const operation = history.addBatch([batchRow(0)], undefined, {
        streamPublication: true,
        awaitDurableCommit: true,
        afterPublication: () => {
          published = true;
        },
      });
      await waitForPausedWrite;
      expect(await nextTurns(operation)).toBe(false);
      expect(published).toBe(false);
      expect(owners.snapshot().liveRows).toBe(2);
      releaseWriter();
      await operation;
      expect(published).toBe(true);
      expect(owners.snapshot().liveRows).toBe(0);
      return history.length();
    },
  );
}

async function cancelledFinalAdmission(): Promise<number> {
  return withBatchFixture(
    async ({
      history,
      recorder,
      owners,
      pauseWriter,
      waitForPausedWrite,
      releaseWriter,
    }) => {
      const controller = new AbortController();
      const failure = new Error('cancel published admission');
      pauseWriter();
      let published = false;
      const operation = history.detachedValues.append(
        [batchRow(0)],
        undefined,
        {
          streamPublication: true,
          signal: controller.signal,
          afterPublication: () => {
            published = true;
            controller.abort(failure);
          },
        },
      );
      void operation.catch(() => undefined);
      await waitForPausedWrite;
      await turns();
      expect(published).toBe(true);
      expect(owners.snapshot().liveRows).toBe(2);
      expect(await nextTurns(operation)).toBe(false);
      releaseWriter();
      await expect(operation).rejects.toBe(failure);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(history.length()).toBe(0);
      expect((await detachedDurableDigest(recorder)).count).toBe(0);
      expect(history.getTotalTokens()).toBe(0);
      return history.length();
    },
  );
}

async function cancelledSubmission(
  history: HistoryService,
  owners: BatchOwnerCensus,
): Promise<ReadonlyArray<WeakRef<object>>> {
  const controller = new AbortController();
  const failure = new Error('cancel first capture');
  const input = submission(512);
  owners.registerInput(input.rows);
  const operation = history.detachedValues.append(input.rows, undefined, {
    signal: controller.signal,
  });
  expect(owners.snapshot().liveRows).toBe(512);
  input.rows = [];
  controller.abort(failure);
  await expect(operation).rejects.toBe(failure);
  return input.weak;
}

async function firstTurnCancellation(): Promise<number> {
  return withBatchFixture(async ({ history, owners }) => {
    const weak = await cancelledSubmission(history, owners);
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.snapshot().liveSerializedBytes).toBe(0);
    expect(history.length()).toBe(0);
    expect(await collected(weak)).toBe(0);
    return history.length();
  });
}

async function namedAcknowledgement(): Promise<number> {
  return withBatchFixture(
    async ({
      history,
      owners,
      pauseWriter,
      waitForPausedWrite,
      releaseWriter,
    }) => {
      pauseWriter();
      let acknowledged = false;
      const operation = history.detachedValues.append(
        [batchRow(0)],
        undefined,
        {
          streamPublication: true,
          onAcknowledged: () => {
            acknowledged = true;
          },
        },
      );
      await waitForPausedWrite;
      await turns();
      expect(acknowledged).toBe(false);
      expect(owners.snapshot().liveRows).toBe(2);
      releaseWriter();
      await operation;
      expect(acknowledged).toBe(true);
      expect(owners.snapshot().liveRows).toBe(0);
      return history.length();
    },
  );
}

describe('addBatch streaming temporal contract', () => {
  it('returns after the final admission so its caller can release a paused writer', async () => {
    expect(await finalAdmission()).toBe(1);
  });
  it('allows publication callback to release the final writer and compensate its exact rejection', async () => {
    expect(await callbackCompensation()).toBe(1);
  });
  it('explicit durable mode does not return or notify before the writer is released', async () => {
    expect(await explicitDurability()).toBe(1);
  });
  it('keeps cancelled final admission charged until released compensation settles', async () => {
    expect(await cancelledFinalAdmission()).toBe(0);
  });
  it('does not call an explicitly named acknowledgement before durability', async () => {
    expect(await namedAcknowledgement()).toBe(1);
  });
  it('releases the caller submission when cancelled on the first capture turn', async () => {
    expect(await firstTurnCancellation()).toBe(0);
  });
});
