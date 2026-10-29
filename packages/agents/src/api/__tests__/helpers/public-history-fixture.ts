import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import { buildAgent, type Agent } from './agentHarness.js';
import { spyOn } from 'bun:test';
import { SessionClientOwner } from '../../../session/session-client-owner.js';

async function buildHistoryAgent(): Promise<{
  agent: Agent;
  owner: SessionClientOwner;
  cleanup: () => Promise<void>;
}> {
  let owner: SessionClientOwner | undefined;
  const create = SessionClientOwner.create;
  const capture = spyOn(SessionClientOwner, 'create').mockImplementation(
    async (...args) => {
      owner = await create(...args);
      return owner;
    },
  );
  try {
    const built = await buildAgent('plain-text.jsonl');
    if (owner === undefined) {
      await built.cleanup();
      throw new Error('Public history fixture did not acquire a session owner');
    }
    return { ...built, owner };
  } finally {
    capture.mockRestore();
  }
}

export class StreamOnlyHistory extends HistoryService {
  failAfter: number | undefined;
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'history array forbidden');
  }

  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    let count = 0;
    for await (const row of super.streamRawHistory(signal)) {
      yield row;
      if (++count === this.failAfter) throw new Error('raw source fault');
    }
  }
}

export async function withPublicHistory<T>(
  size: number,
  active: boolean,
  action: (
    agent: Agent,
    history: HistoryService,
    reader: RowOwnership,
    decoded: () => number,
  ) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  return withSuffixFixture(
    size,
    async (history, reader, counters) => {
      const { agent, owner, cleanup } = await buildHistoryAgent();
      const client = owner.clients.getAgentClient();
      const priorHistory = client.getHistoryService();
      client.storeHistoryServiceForReuse(history);
      try {
        if (active) await client.startChat([]);
        const before = counters.snapshot().rowsDecoded;
        return await action(
          agent,
          history,
          reader,
          () => counters.snapshot().rowsDecoded - before,
        );
      } finally {
        try {
          await cleanup();
        } finally {
          if (priorHistory !== history) await priorHistory?.dispose();
        }
      }
    },
    bytes,
    accountingRow,
    undefined,
    (options) => new StreamOnlyHistory(options),
  );
}
