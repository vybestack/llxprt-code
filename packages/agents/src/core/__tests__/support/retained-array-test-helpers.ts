/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { buildAgent } from '../../../api/__tests__/helpers/agentHarness.js';
import type { DetachedFixture } from '../../../../../core/src/services/history/detached-rollback-test-helpers.js';
import type { LocalMediaStore } from '../../../../../core/src/storage/local-media-store.js';
import type { AgentClientContract } from '../../../../../core/src/core/clientContract.js';

export async function withRetainedClient<T>(
  fixture: DetachedFixture,
  action: (value: {
    client: AgentClientContract;
    store: LocalMediaStore;
  }) => Promise<T>,
): Promise<T> {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  try {
    const client = await agent.sessionClient.createDetachedAgentClient();
    try {
      const store = client.mediaStore;
      if (store === undefined)
        throw new Error('Detached agent client has no media store');
      client.storeHistoryServiceForReuse(fixture.history);
      return await action({ client, store });
    } finally {
      await client.dispose();
    }
  } finally {
    await cleanup();
  }
}
