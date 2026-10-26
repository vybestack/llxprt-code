/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentChatContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/modelEnvelope.js';

function emptyChatStream(): AsyncGenerator<never> {
  return (async function* (): AsyncGenerator<never> {})();
}

export function createTestAgentChat(): AgentChatContract {
  return {
    sendMessage: async (_params, promptId) => ({
      status: 'empty',
      promptId,
      turnId: 'unused',
    }),
    sendMessageStream: async () => emptyChatStream(),
    generateDirectMessage: async () => emptyModelOutput(),
    getHistory: () => emptyChatStream(),
    async *streamHistory(signal) {
      signal?.throwIfAborted();
      yield* [];
    },
    setHistory: async () => {},
    clearHistory: async () => {},
    getHistoryService: () => null,
    wasRecentlyCompressed: () => false,
    performCompression: async () => PerformCompressionResult.SKIPPED_EMPTY,
    takeHistoryAdmissions: () => [],
    recordCompletedToolCalls: () => {},
  };
}
