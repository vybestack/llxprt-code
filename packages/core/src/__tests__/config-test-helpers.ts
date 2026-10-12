/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TestMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';

export { makeFakeConfig } from '@vybestack/llxprt-code-test-utils/core/config.js';

import { initializeTestConfig as initializeConfig } from '@vybestack/llxprt-code-test-utils/core/config.js';
import type { Config } from '../config/config.js';

export async function initializeTestConfig(
  ...args: Parameters<typeof initializeConfig>
): Promise<TestMcpRuntime> {
  const runtime = await initializeConfig(...args);
  return runtime;
}
import type { RuntimeProviderManager } from '../../index.js';
import type {
  AgentClientContract,
  AgentChatContract,
} from '../core/clientContract.js';
import {
  PerformCompressionResult,
  type ServerAgentStreamEvent,
} from '../core/turn.js';
import { emptyModelOutput } from '../llm-types/modelEnvelope.js';
async function* fromAsyncArray<T>(items: T[]): AsyncGenerator<T, void> {
  for (const item of items) {
    yield item;
  }
}

function emptyServerAgentStream(): AsyncGenerator<
  ServerAgentStreamEvent,
  unknown
> {
  return fromAsyncArray<ServerAgentStreamEvent>([]);
}

function emptyChatStream(): AsyncGenerator<never> {
  return fromAsyncArray<never>([]);
}

function createTestAgentChat(): AgentChatContract {
  return {
    sendMessage: async () => emptyModelOutput(),
    sendMessageStream: async () => emptyChatStream(),
    generateDirectMessage: async () => emptyModelOutput(),
    getHistory: () => [],
    setHistory: async () => {},
    clearHistory: () => {},
    getHistoryService: () => null,
    wasRecentlyCompressed: () => false,
    performCompression: async () => PerformCompressionResult.SKIPPED_EMPTY,
    takeHistoryAdmissions: () => [],
    recordCompletedToolCalls: () => {},
  };
}

export function createTestAgentClient(
  overrides?: Partial<AgentClientContract>,
  identity?: {
    readonly config: Config;
    readonly manager: RuntimeProviderManager;
  },
): AgentClientContract {
  const chat = createTestAgentChat();
  let tools: AgentClientContract['tools'] = {
    getTool: () => undefined,
    getAllToolNames: () => [],
    getAllTools: () => [],
    getEnabledTools: () => [],
    getFunctionDeclarations: () => [],
    getFunctionDeclarationsFiltered: () => [],
  };
  return {
    get tools() {
      return tools;
    },
    bindProviderInvocation: () => {},
    bindRuntimeSettings: () => {},
    bindTelemetry: () => {},
    bindToolSelection: (selection) => {
      tools = selection;
    },
    assertConfig: (config) => {
      if (identity?.config !== config)
        throw new Error('Test client Config identity mismatch');
    },
    assertProviderManager: (manager) => {
      if (identity?.manager !== manager)
        throw new Error('Test client manager identity mismatch');
    },
    initialize: async () => {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    getChat: () => chat,
    getHistory: async () => [],
    getHistoryService: () => null,
    storeHistoryServiceForReuse: () => {},
    prepareHistoryRebind: () => () => {},
    storeHistoryForLaterUse: async () => {},
    dispose: async () => {},
    setTools: async () => {},
    clearTools: () => {},
    updateSystemInstruction: async () => {},
    addHistory: async () => {},
    resetChat: async () => {},
    resumeChat: async () => {},
    setHistory: async () => {},
    restoreHistory: async () => {},
    addDirectoryContext: async () => {},
    getContentGenerator: () => undefined as never,
    getContentGeneratorConfig: () => undefined,
    startChat: async () => chat,
    generateDirectMessage: async () => emptyModelOutput(),
    generateJson: async () => ({}),
    generateContent: async () => emptyModelOutput(),
    generateEmbedding: async (texts: string[]) => texts.map(() => []),
    sendMessageStream: () => emptyServerAgentStream(),
    getCurrentSequenceModel: () => null,
    ...overrides,
  };
}
