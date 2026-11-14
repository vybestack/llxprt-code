/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientContract } from '../../../../../core/src/core/clientContract.js';
import type { RowOwnership } from '../../../../../core/src/recording/rowOwnership.js';
import type { DetachedFixture } from '../../../../../core/src/services/history/detached-rollback-test-helpers.js';
import type { LocalMediaStore } from '../../../../../core/src/storage/local-media-store.js';
import { buildCliStyleConfig } from '../../../api/__tests__/helpers/buildCliStyleConfig.js';

export async function withRetainedClient<T>(
  fixture: Pick<DetachedFixture, 'history' | 'recorder' | 'releaseWriter'> & {
    readonly owners: RowOwnership;
  },
  action: (value: {
    client: AgentClientContract;
    store: LocalMediaStore;
  }) => Promise<T>,
): Promise<T> {
  const built = await buildCliStyleConfig('plain-text.jsonl');
  const { cleanup, sessionClient } = built;
  try {
    await sessionClient.clients.refreshAuth();
    const client = built.agentClient;
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
