/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/modelEnvelope.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { ServerAgentStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import { createTestAgentChat } from './fixture-agent-chat.js';

async function* fromAsyncArray<T>(items: T[]): AsyncGenerator<T, void> {
  for (const item of items) {
    yield item;
  }
}

function missingContentGenerator(): never {
  throw new Error('Fixture client has no content generator');
}

function emptyServerAgentStream(): AsyncGenerator<
  ServerAgentStreamEvent,
  unknown
> {
  return fromAsyncArray<ServerAgentStreamEvent>([]);
}

export function createTestAgentClient(
  overrides?: Partial<AgentClientContract>,
  identity?: {
    readonly config: Config;
    readonly manager: RuntimeProviderManager;
  },
): AgentClientContract {
  const chat = createTestAgentChat();
  let selection: ToolSelection = {
    getTool: () => undefined,
    getAllToolNames: () => [],
    getAllTools: () => [],
    getEnabledTools: () => [],
    getFunctionDeclarations: () => [],
    getFunctionDeclarationsFiltered: () => [],
  };
  return {
    get tools() {
      return selection;
    },
    bindProviderInvocation: () => {},
    bindRuntimeSettings: () => {},
    bindTelemetry: () => {},
    bindModelNotifications: () => {},
    bindIdeContext: () => {},
    bindWorkspaceDefinitions: () => {},
    bindProviderFiles: () => {},
    bindTokenization: () => {},
    bindProviderSelection: () => {},
    bindToolSelection: (tools) => {
      selection = tools;
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
    async *getHistory() {},
    async *streamHistory(signal) {
      signal?.throwIfAborted();
      yield* overrides?.getHistory?.() ?? [];
    },
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
    discardDeferredHistory: async () => {},
    setHistory: async () => {},
    setHistoryFromSource: async () => {
      throw new Error('Streamed history requires a real agent client');
    },
    restoreHistory: async () => {},
    addDirectoryContext: async () => {},
    getContentGenerator: missingContentGenerator,
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
