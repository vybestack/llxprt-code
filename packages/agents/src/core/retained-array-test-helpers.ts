/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import { createAgentRuntimeState } from '../../../core/src/runtime/AgentRuntimeState.js';
import { LocalMediaStore } from '../../../core/src/storage/local-media-store.js';
import type { DetachedFixture } from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import { AgentClient } from './client.js';
import type { Config } from '../../../core/src/config/config.js';

export async function withRetainedClient<T>(
  fixture: DetachedFixture,
  action: (value: {
    client: AgentClient;
    store: LocalMediaStore;
    config: Config;
  }) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'retained-array-'));
  const store = new LocalMediaStore({
    rootDirectory: root,
    quotaBytes: 16 * 1024 * 1024,
  });
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  const config = internalConfig(agent);
  Object.defineProperty(config, 'getLocalMediaStore', {
    value: () => store,
    configurable: true,
  });
  const client = new AgentClient(
    config,
    createAgentRuntimeState({
      runtimeId: randomUUID(),
      provider: 'fake',
      model: 'fake-model',
    }),
  );
  client.storeHistoryServiceForReuse(fixture.history);
  try {
    return await action({ client, store, config });
  } finally {
    await client.dispose();
    await cleanup();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}
