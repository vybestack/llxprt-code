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
}

export function bindTurnModel(client: AgentClientContract): TurnModelExecution {
  return {
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
