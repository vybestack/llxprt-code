import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type { Agent } from '@vybestack/llxprt-code-agents';
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

export function replayClient(
  history: HistoryService,
): Pick<Agent, 'streamHistory'> & { dispose(): Promise<void> } {
  return {
    streamHistory: (signal) => history.streamRawHistory(signal),
    dispose: async () => {
      history.dispose();
    },
  };
}
