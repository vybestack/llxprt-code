import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  accountingRow,
  deferred,
} from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

export class ControlledOrchestratorHistory extends HistoryService {
  readonly paused = deferred();
  readonly release = deferred();
  readonly consumer = new RowOwnership();
  private readonly retained: IContent[] = [];
  pauseAfter: number | undefined;
  fault: unknown;
  retaining: 'borrowed' | 'copy' | undefined;
  scanned = 0;
  digest: string | undefined;
  private captured = false;
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'orchestrator eager history forbidden',
    );
  }

  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    const first = !this.captured;
    this.captured = true;
    const hash = createHash('sha256');
    let count = 0;
    for await (const row of super.streamRawHistory(signal)) {
      count++;
      hash.update(JSON.stringify(row));
      if (first && this.retaining !== undefined) {
        const owned = this.retaining === 'copy' ? structuredClone(row) : row;
        this.consumer.retain(owned);
        this.retained.push(owned);
      }
      if (first && count === this.pauseAfter) {
        this.scanned = count;
        this.paused.resolve();
        await this.release.promise;
        signal?.throwIfAborted();
        if (this.fault !== undefined) throw this.fault;
      }
      yield row;
    }
    if (first) {
      this.scanned = count;
      this.digest = hash.digest('hex');
    }
  }

  releaseConsumer(): void {
    for (const row of this.retained) this.consumer.release(row);
    this.retained.length = 0;
  }
}

export function expectedHistoryDigest(size: number, bytes = 2048): string {
  const hash = createHash('sha256');
  for (let index = 0; index < size; index++)
    hash.update(JSON.stringify(accountingRow(index, bytes)));
  return hash.digest('hex');
}

export async function sendHistoryTurn(
  client: AgentClientContract,
  signal = new AbortController().signal,
): Promise<string> {
  let output = '';
  for await (const event of client.sendMessageStream(
    'reply plainly',
    signal,
    'stream-history-turn',
    1,
  )) {
    if (event.type === 'content') output += event.value;
  }
  return output;
}

export async function withOrchestratorHistory<T>(
  size: number,
  action: (
    client: AgentClientContract,
    history: ControlledOrchestratorHistory,
    reader: RowOwnership,
    config: Config,
  ) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  return withSuffixFixture(
    size,
    async (history, reader) => {
      if (!(history instanceof ControlledOrchestratorHistory))
        throw new Error('Missing controlled history');
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const config = internalConfig(agent);
      config.setEphemeralSetting('context-limit', 100_000_000);
      const client = config.getAgentClient();
      client.storeHistoryServiceForReuse(history);
      try {
        await client.startChat([]);
        return await action(client, history, reader, config);
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
