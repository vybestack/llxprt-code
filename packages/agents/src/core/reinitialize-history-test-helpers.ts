/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { withSuffixFixture } from '@vybestack/llxprt-code-core/services/history/history-suffix-test-helpers.js';
import {
  accountingFactory,
  accountingRow,
} from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import { ControlledOrchestratorHistory } from './orchestrator-history-test-helpers.js';

export function reinitializeConfig(config: Config): ContentGeneratorConfig {
  const composed = config.getContentGeneratorConfig();
  if (composed === undefined)
    throw new Error('Missing composed provider config');
  return composed;
}
export const reinitializeBounds = {
  rows: 440,
  serializedBytes: 8 * 1024 * 1024,
};

export function recordReinitializeOwners(
  size: number,
  phase: string,
  owners: RowOwnership,
): void {
  const path = process.env.REINITIALIZE_HISTORY_OUTPUT;
  if (path !== undefined)
    appendFileSync(
      path,
      JSON.stringify({ size, phase, ...owners.snapshot() }) + '\n',
    );
}

export async function historyDigest(
  rows: AsyncIterable<IContent>,
): Promise<{ count: number; digest: string }> {
  let count = 0;
  const hash = createHash('sha256');
  for await (const row of rows) {
    count++;
    hash.update(JSON.stringify(row));
  }
  return { count, digest: hash.digest('hex') };
}

export async function withReinitializeHistory<T>(
  size: number,
  action: (
    client: AgentClientContract,
    source: ControlledOrchestratorHistory,
    owners: RowOwnership,
    config: Config,
  ) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  return withSuffixFixture(
    size,
    async (history, owners) => {
      if (!(history instanceof ControlledOrchestratorHistory))
        throw new Error('Missing controlled journal');
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const config = internalConfig(agent);
      config.setTokenizerFactory(accountingFactory((text) => text.length));
      config.setEphemeralSetting('context-limit', 100_000_000);
      const client = config.getAgentClient();
      client.storeHistoryServiceForReuse(history);
      try {
        await client.startChat([]);
        return await action(client, history, owners, config);
      } finally {
        history.release.resolve();
        history.releaseConsumer();
        await cleanup();
      }
    },
    bytes,
    accountingRow,
    undefined,
    (options) => new ControlledOrchestratorHistory(options),
  );
}
