import { persistToolPresentations } from '../core/agenticLoop/toolPresentationRecording.js';
import { persistApprovalLifecycle } from '../core/agenticLoop/approvalLifecycleRecording.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgenticLoopOptions } from '../core/agenticLoop/types.js';
import { recordCompletedToolHistory } from '../core/agenticLoop/loopHelpers.js';

interface TurnModelExecution {
  readonly streamModel: AgenticLoopOptions['streamModel'];
  readonly recordToolHistory: AgenticLoopOptions['recordToolHistory'];
  readonly recordToolPresentations: AgenticLoopOptions['recordToolPresentations'];
  readonly persistApproval: AgenticLoopOptions['persistApproval'];
}

export function bindTurnModel(client: AgentClientContract): TurnModelExecution {
  return {
    recordToolPresentations: (calls, origin) =>
      persistToolPresentations(calls, client.getHistoryService(), origin),
    persistApproval: (record, origin) =>
      persistApprovalLifecycle(record, client.getHistoryService(), origin),
    streamModel: (message, signal, promptId, recording, parameters) =>
      client.sendMessageStream(
        message,
        signal,
        promptId,
        undefined,
        false,
        false,
        recording,
        parameters,
      ),
    recordToolHistory: (calls) =>
      recordCompletedToolHistory(calls, (content) =>
        client.addHistory(content),
      ),
  };
}
