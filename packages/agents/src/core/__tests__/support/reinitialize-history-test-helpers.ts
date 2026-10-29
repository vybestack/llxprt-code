/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  accountingFactory,
  accountingRow,
} from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { buildCliStyleConfig } from '../../../api/__tests__/helpers/buildCliStyleConfig.js';
import { bindClientTokenization } from './test-tokenization.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { ControlledOrchestratorHistory } from './orchestrator-history-test-helpers.js';

export function reinitializeConfig(
  client: AgentClientContract,
): ContentGeneratorConfig {
  const composed = client.getContentGeneratorConfig();
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
    sessionClient: SessionClientOwner,
  ) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  return withSuffixFixture(
    size,
    async (history, owners) => {
      if (!(history instanceof ControlledOrchestratorHistory))
        throw new Error('Missing controlled journal');
      const {
        agentClient: client,
        cleanup,
        config,
        settingsOwner,
        sessionClient,
      } = await buildCliStyleConfig('plain-text.jsonl');
      bindClientTokenization(
        client,
        accountingFactory((text) => text.length),
      );
      settingsOwner.writeNamedParameter('context-limit', 100_000_000);
      const priorHistory = client.getHistoryService();
      client.storeHistoryServiceForReuse(history);
      try {
        await client.startChat([]);
        return await action(client, history, owners, config, sessionClient);
      } finally {
        history.release.resolve();
        history.releaseConsumer();
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
    (options) => new ControlledOrchestratorHistory(options),
  );
}
