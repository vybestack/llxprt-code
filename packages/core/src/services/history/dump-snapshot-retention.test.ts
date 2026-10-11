/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectedWithin } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { HistoryService } from './HistoryService.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type { IContent } from './IContent.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';

function valueRow(index: number, bytes: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `${index}:${'x'.repeat(bytes)}` }],
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: index,
        step: 1,
        recordedAt: index,
      },
    },
  };
}

function capture(
  count: number,
  bytes: number,
): {
  history: HistoryService;
  opening: Promise<HistoryDumpSnapshot>;
  probes: Array<WeakRef<IContent>>;
  ownership: RowOwnership;
} {
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  const history = new HistoryService({
    attachmentCounters: { ...counters.counters, ownership },
  });
  const probes: Array<WeakRef<IContent>> = [];
  for (let index = 0; index < count; index++) {
    const value = valueRow(index, bytes);
    probes.push(new WeakRef(value));
    history.add(value);
  }
  return { history, probes, ownership, opening: history.openDumpSnapshot() };
}

async function settle(probes: ReadonlyArray<WeakRef<object>>): Promise<void> {
  await Promise.all(probes.map((probe) => collectedWithin(probe)));
}

describe('held production dump snapshots release caller identities', () => {
  for (const [count, bytes] of [
    [512, 1024],
    [8192, 1024],
    [1, 9 * 1024 * 1024],
  ]) {
    it(`keeps disk values after ${count} pending rows of ${bytes} bytes retire`, async () => {
      const fixture = capture(count, bytes);
      const snapshot = await fixture.opening;
      try {
        await fixture.history.waitForTokenUpdates();
        await fixture.history.waitForCommit();
        fixture.history.dispose();
        await settle(fixture.probes);
        expect(
          fixture.probes.filter((probe) => probe.deref() !== undefined),
        ).toHaveLength(0);
        expect(fixture.ownership.snapshot()).toMatchObject({
          liveRows: 0,
          liveSerializedBytes: 0,
        });
        const actual = createHash('sha256');
        const expected = createHash('sha256');
        for (let index = 0; index < count; index++)
          expected.update(JSON.stringify(valueRow(index, bytes)));
        let read = 0;
        for await (const value of snapshot.rows()) {
          actual.update(JSON.stringify(value));
          read++;
          expect(fixture.ownership.snapshot().liveRows).toBe(1);
        }
        expect(read).toBe(count);
        expect(actual.digest('hex')).toBe(expected.digest('hex'));
        expect(fixture.ownership.snapshot().liveRows).toBe(0);
      } finally {
        await snapshot.close();
        fixture.history.dispose();
      }
    }, 120_000);
  }
});
