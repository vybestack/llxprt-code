/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import { assertDefaultHistory } from './public-default-history-test-helpers.js';
import { ChatSession } from './chatSession.js';

const cases = [512, 8192].flatMap((size) =>
  [false, true].map((explicitFalse) => ({ size, explicitFalse })),
);
for (const { size, explicitFalse } of cases) {
  describe(`chat ${explicitFalse ? 'false' : 'default'} history ${size}`, () => {
    it('returns a scoped cold stream rather than publishing the full transcript array', async () => {
      await withSuffixFixture(
        size,
        async (history, reader) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          const client = internalConfig(agent).getAgentClient();
          client.storeHistoryServiceForReuse(history);
          try {
            const chat = await client.startChat([]);
            if (!(chat instanceof ChatSession))
              throw new Error('Expected real ChatSession');
            await assertDefaultHistory(
              explicitFalse ? chat.getHistory(false) : chat.getHistory(),
              size,
              reader,
            );
            expect(reader.snapshot().liveRows).toBe(0);
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

describe('chat default oversized row', () => {
  it('streams a valid 9 MiB row without narrowing the row contract', async () => {
    await withSuffixFixture(
      1,
      async (history, reader) => {
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        const client = internalConfig(agent).getAgentClient();
        client.storeHistoryServiceForReuse(history);
        try {
          const chat = await client.startChat([]);
          await assertDefaultHistory(
            chat.getHistory(),
            1,
            reader,
            9 * 1024 * 1024,
          );
          expect(reader.snapshot().liveRows).toBe(0);
        } finally {
          await cleanup();
        }
      },
      9 * 1024 * 1024,
      accountingRow,
    );
  }, 180_000);
});
