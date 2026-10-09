/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import { assertDefaultHistory } from './public-default-history-test-helpers.js';

const cases = [512, 8192].flatMap((size) =>
  [false, true].flatMap((active) =>
    [false, true].map((explicitFalse) => ({ size, active, explicitFalse })),
  ),
);
for (const { size, active, explicitFalse } of cases) {
  describe(`client ${active ? 'active' : 'inactive'} ${explicitFalse ? 'false' : 'default'} history ${size}`, () => {
    it('delivers the complete transcript as a cold stream with bounded external ownership', async () => {
      await withSuffixFixture(
        size,
        async (history, reader) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          const client = internalConfig(agent).getAgentClient();
          client.storeHistoryServiceForReuse(history);
          try {
            if (active) await client.startChat([]);
            const before = reader.snapshot().acquisitions;
            const source = explicitFalse
              ? client.getHistory(false)
              : client.getHistory();
            expect(reader.snapshot().acquisitions - before).toBe(0);
            await assertDefaultHistory(source, size, reader);
          } finally {
            await cleanup();
          }
        },
        2048,
        accountingRow,
      );
    }, 120_000);
  });
}

describe('client default history ownership lifetime', () => {
  it('accepts an untruncated nine MiB row', async () => {
    const bytes = 9 * 1024 * 1024;
    await withSuffixFixture(
      1,
      async (history, reader) => {
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        try {
          const client = internalConfig(agent).getAgentClient();
          client.storeHistoryServiceForReuse(history);
          await assertDefaultHistory(client.getHistory(), 1, reader, bytes);
          expect(reader.snapshot().liveRows).toBe(0);
        } finally {
          await cleanup();
        }
      },
      bytes,
      accountingRow,
    );
  }, 120_000);

  it('pins only on first next and releases a paused reader on return and abort', async () => {
    await withSuffixFixture(
      6,
      async (history, reader, counters) => {
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        try {
          const client = internalConfig(agent).getAgentClient();
          client.storeHistoryServiceForReuse(history);
          const controller = new AbortController();
          const cursor = client.getHistory(false, controller.signal);
          expect(reader.snapshot().acquisitions).toBe(0);
          expect((await cursor.next()).value).toStrictEqual(accountingRow(0));
          history.clear();
          expect({
            decoded: counters.snapshot().rowsDecoded,
            held: reader.snapshot().liveRows,
          }).toStrictEqual({ decoded: 1, held: 1 });
          controller.abort(new Error('stop public history'));
          await expect(cursor.next()).rejects.toThrow('stop public history');
          expect(reader.snapshot().liveRows).toBe(0);
          expect((await client.getHistory().next()).done).toBe(true);
        } finally {
          await cleanup();
        }
      },
      2048,
      accountingRow,
    );
  });
});
