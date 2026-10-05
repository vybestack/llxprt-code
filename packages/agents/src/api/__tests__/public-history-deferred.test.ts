/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { buildAgent } from './helpers/agentHarness.js';

for (const size of [512, 8192]) {
  describe(`deferred public snapshot with ${size} mixed rows`, () => {
    it('preserves pinned values across replacement without retaining original row identities', async () => {
      expect(await verifyDeferred(size)).toBe(size);
    }, 120_000);
  });
}

async function verifyDeferred(size: number): Promise<number> {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  const input = Array.from({ length: size }, (_, index) =>
    accountingRow(index),
  );
  const consumer = new RowOwnership();
  try {
    await agent.setHistory(input);
    const cursor = agent.streamHistory();
    const expected = createHash('sha256');
    for (let index = 0; index < size; index++)
      expected.update(JSON.stringify(accountingRow(index)));
    const actual = createHash('sha256');
    try {
      const first = await cursor.next();
      if (first.done === true) throw new Error('Missing first deferred row');
      expect(first.value).not.toBe(input[0]);
      actual.update(JSON.stringify(first.value));
      consumer.retain(first.value);
      consumer.release(first.value);
      await agent.setHistory([accountingRow(size)]);
      for await (const row of cursor) {
        hashBorrowedRow(actual, consumer, row);
      }
    } finally {
      await cursor.return();
    }
    expect(actual.digest('hex')).toBe(expected.digest('hex'));
    expect(consumer.snapshot().peakRows).toBe(1);
    expect(consumer.snapshot().liveRows).toBe(0);
    expect(
      consumer.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
    ).toBe(true);
    const replacement = agent.streamHistory();
    try {
      expect((await replacement.next()).value?.blocks).toStrictEqual(
        accountingRow(size).blocks,
      );
      expect((await replacement.next()).done).toBe(true);
    } finally {
      await replacement.return();
    }
    return consumer.snapshot().acquisitions;
  } finally {
    await cleanup();
  }
}

function hashBorrowedRow(
  hash: ReturnType<typeof createHash>,
  consumer: RowOwnership,
  row: Parameters<RowOwnership['retain']>[0],
): void {
  consumer.retain(row);
  try {
    hash.update(JSON.stringify(row));
  } finally {
    consumer.release(row);
  }
}
