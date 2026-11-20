/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Agent } from '../../../api/agent.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCoreAgent } from './core-agent-fixture.js';
import { StreamOnlyHistory } from '../../../api/__tests__/helpers/public-history-fixture.js';
export { StreamOnlyHistory };

export async function withPublicHistory<T>(
  size: number,
  active: boolean,
  action: (
    agent: Agent,
    history: HistoryService,
    reader: RowOwnership,
    decoded: () => number,
    client: AgentClientContract,
  ) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  return withSuffixFixture(
    size,
    async (history, reader, counters) => {
      const built = await buildCoreAgent('plain-text.jsonl');
      const client = built.agentClient;
      const prior = client.getHistoryService();
      client.storeHistoryServiceForReuse(history);
      try {
        if (active) await client.startChat([]);
        const before = counters.snapshot().rowsDecoded;
        return await action(
          built.agent,
          history,
          reader,
          () => counters.snapshot().rowsDecoded - before,
          client,
        );
      } finally {
        try {
          await built.cleanup();
        } finally {
          if (prior !== history) await prior?.dispose();
        }
      }
    },
    bytes,
    accountingRow,
    undefined,
    (options) => new StreamOnlyHistory(options),
  );
}
