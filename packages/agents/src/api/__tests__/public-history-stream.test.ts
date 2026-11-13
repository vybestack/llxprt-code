/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import { withPublicHistory } from './helpers/public-history-fixture.js';
import { buildAgent } from './helpers/agentHarness.js';

const PUBLIC_HISTORY_ROW_COUNT = 65;
function fixtureBytes(size: number): { total: number; largest: number } {
  let total = 0;
  let largest = 0;
  for (let index = 0; index < size; index++) {
    const bytes = Buffer.byteLength(JSON.stringify(accountingRow(index)));
    total += bytes;
    largest = Math.max(largest, bytes);
  }
  return { total, largest };
}
const PUBLIC_HISTORY_BYTES = fixtureBytes(PUBLIC_HISTORY_ROW_COUNT);
// Ownership charges UTF-8 JSON only: one row, no encoder copies or heap overhead.
const bounds = { rows: 1, serializedBytes: PUBLIC_HISTORY_BYTES.largest };

for (const size of [PUBLIC_HISTORY_ROW_COUNT]) {
  for (const active of [false, true]) {
    describe(`public agent ${active ? 'active' : 'stored'} history with ${size} rows`, () => {
      it('streams the raw mixed transcript bytes with bounded reader ownership', async () => {
        await withPublicHistory(
          size,
          active,
          async (agent, _history, reader) => {
            const actual = createHash('sha256');
            const expected = createHash('sha256');
            let count = 0;
            for await (const row of agent.streamHistory()) {
              actual.update(JSON.stringify(row));
              expected.update(JSON.stringify(accountingRow(count++)));
            }
            expect({ count, digest: actual.digest('hex') }).toStrictEqual({
              count: size,
              digest: expected.digest('hex'),
            });
            expect(reader.snapshot().peakRows).toBeLessThanOrEqual(1);
            expect(reader.snapshot().liveRows).toBe(0);
            expect(reader.within(bounds)).toBe(true);
            expect(PUBLIC_HISTORY_BYTES.total).toBeGreaterThan(
              4 * bounds.serializedBytes,
            );
            process.stdout.write(
              `PUBLIC_HISTORY_BYTES ${JSON.stringify({ active, ...PUBLIC_HISTORY_BYTES, bounds, ...reader.snapshot() })}\n`,
            );
          },
        );
      }, 120_000);

      it('pins membership on first next across live clear and observes consumer backpressure', async () => {
        await withPublicHistory(
          size,
          active,
          async (agent, history, reader, decoded) => {
            const cursor = agent.streamHistory();
            try {
              const first = await cursor.next();
              expect(first.value).toStrictEqual(accountingRow(0));
              await history.clear();
              await delay(10);
              expect({
                decoded: decoded(),
                held: reader.snapshot().liveRows,
              }).toStrictEqual({ decoded: 1, held: 1 });
              const second = await cursor.next();
              expect(second.value).toStrictEqual(accountingRow(1));
            } finally {
              await cursor.return();
            }
            expect(reader.snapshot().liveRows).toBe(0);
            expect((await agent.streamHistory().next()).done).toBe(true);
          },
        );
      }, 120_000);

      it('releases its pinned reader when the consumer throws or aborts', async () => {
        await withPublicHistory(
          size,
          active,
          async (agent, _history, reader, decoded) => {
            const failure = async (): Promise<void> => {
              for await (const _row of agent.streamHistory())
                throw new Error('consumer fault');
            };
            await expect(failure()).rejects.toThrow('consumer fault');
            expect(reader.snapshot().liveRows).toBe(0);
            const controller = new AbortController();
            const cursor = agent.streamHistory(controller.signal);
            await cursor.next();
            controller.abort(new Error('stop history'));
            await expect(cursor.next()).rejects.toThrow('stop history');
            expect({
              decoded: decoded(),
              live: reader.snapshot().liveRows,
            }).toStrictEqual({ decoded: 2, live: 0 });
          },
        );
      }, 120_000);
    });
  }
}

describe('public history stream lifecycle', () => {
  it.each([false, true])(
    'control: retaining streamed rows exceeds the same byte allowance, active=%s',
    async (active) => {
      await withPublicHistory(
        PUBLIC_HISTORY_ROW_COUNT,
        active,
        async (agent, _history, reader) => {
          const held = [];
          try {
            for await (const row of agent.streamHistory()) {
              reader.retain(row);
              held.push(row);
            }
            expect(reader.within(bounds)).toBe(false);
            expect(reader.snapshot().peakSerializedBytes).toBeGreaterThan(
              3 * bounds.serializedBytes,
            );
            expect(reader.snapshot().liveRows).toBe(PUBLIC_HISTORY_ROW_COUNT);
            process.stdout.write(
              `PUBLIC_HISTORY_CONTROL ${JSON.stringify({ active, ...PUBLIC_HISTORY_BYTES, bounds, ...reader.snapshot() })}\n`,
            );
          } finally {
            for (const row of held) reader.release(row);
          }
          expect(reader.snapshot().liveRows).toBe(0);
        },
      );
    },
    120_000,
  );

  it('does not acquire an unused or pre-aborted reader', async () => {
    await withPublicHistory(2, false, async (agent, _history, reader) => {
      await agent.streamHistory().return();
      const controller = new AbortController();
      controller.abort(new Error('already stopped'));
      await expect(
        agent.streamHistory(controller.signal).next(),
      ).rejects.toThrow('already stopped');
      expect(reader.snapshot().acquisitions).toBe(0);
    });
  });

  it('preserves a valid row of 128 KiB without truncation', async () => {
    const bytes = 128 * 1024;
    await withPublicHistory(
      1,
      false,
      async (agent, _history, reader) => {
        let digest = '';
        for await (const row of agent.streamHistory())
          digest = createHash('sha256')
            .update(JSON.stringify(row))
            .digest('hex');
        expect(digest).toBe(
          createHash('sha256')
            .update(JSON.stringify(accountingRow(0, bytes)))
            .digest('hex'),
        );
        expect(reader.snapshot().liveRows).toBe(0);
      },
      bytes,
    );
  }, 120_000);

  it('pins deferred raw membership while replacement changes the live client', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.setHistory([accountingRow(0), accountingRow(1)]);
      const cursor = agent.streamHistory();
      try {
        expect((await cursor.next()).value?.blocks).toStrictEqual(
          accountingRow(0).blocks,
        );
        await agent.setHistory([accountingRow(2)]);
        expect((await cursor.next()).value?.blocks).toStrictEqual(
          accountingRow(1).blocks,
        );
      } finally {
        await cursor.return();
      }
      const current = agent.streamHistory();
      try {
        expect((await current.next()).value?.blocks).toStrictEqual(
          accountingRow(2).blocks,
        );
      } finally {
        await current.return();
      }
    } finally {
      await cleanup();
    }
  });
});
