/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AfterTurnView, ProviderReplayData } from '../index.js';

const viewWithAgent: AfterTurnView = {
  result: {
    outcome: 'done',
    finalText: '',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    },
    checkpoint: 'checkpoint-1',
    droppedSteers: 0,
  },
  continuationPass: 0,
  thinkingOnly: false,
  tools: [],
  agent: {},
};

const replayWithExecutableData: ProviderReplayData = {
  id: 'replay-1',
  scope: {
    provider: 'provider',
    model: 'model',
    endpoint: 'endpoint',
    principal: 'principal',
  },
  format: 'provider/v1',
  target: { kind: 'entry' },
  data: () => null,
};

export { replayWithExecutableData, viewWithAgent };
