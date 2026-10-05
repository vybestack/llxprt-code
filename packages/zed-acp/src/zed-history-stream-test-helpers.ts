import { forbidHistoryMaterializationForTest } from '../../core/src/test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { AgentClient } from '@vybestack/llxprt-code-agents/internals.js';
import { makeFakeConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { mapHistoryToSessionUpdates } from './zed-session-replay.js';

export class NoArrayHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'raw arrays forbidden');
  }
}

export function replayOracle(size: number): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        mapHistoryToSessionUpdates(
          Array.from({ length: size }, (_, index) => accountingRow(index)),
        ),
      ),
    )
    .digest('hex');
}

export function replayClient(history: HistoryService): AgentClient {
  const config = makeFakeConfig();
  const client = new AgentClient(
    config,
    createAgentRuntimeState({
      runtimeId: 'replay-cursor',
      sessionId: 'replay-cursor',
      provider: 'test',
      model: 'test',
    }),
  );
  client.storeHistoryServiceForReuse(history);
  return client;
}
