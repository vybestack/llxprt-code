/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEvent, Agent } from '@vybestack/llxprt-code-agents';

/**
 * Creates a minimal fake Agent that yields canned AgentEvent arrays from its
 * stream(). Used by useAgentEventStream test files. The fake delegates nothing
 * to the real engine — it is a lightweight event-delivery stub.
 *
 * Optional `overrides` can replace any property (e.g. `stream` for custom
 * generators, or `tools.setDisplayCallbacks` for spy capture).
 */
export function createFakeAgent(
  events: AgentEvent[],
  overrides?: Partial<Agent>,
): Agent {
  async function* gen(): AsyncIterable<AgentEvent> {
    for (const e of events) yield e;
  }
  const base = createBaseFakeAgent(gen);
  return { ...base, ...overrides } as Agent;
}

function createStubTools(): Agent['tools'] {
  return {
    list: () => [],
    async setEnabled() {},
    onConfirmationRequest: () => () => {},
    respondToConfirmation: (
      _confirmationId: string,
      _decision?: unknown,
      _payload?: unknown,
      _requiresUserConfirmation?: boolean,
    ) => {},
    onToolUpdate: () => () => {},
    setEditorCallbacks: () => {},
    setDisplayCallbacks: () => {},
    recordCompletedToolCalls: () => {},
    keys: {} as unknown as Agent['tools']['keys'],
  };
}

function createStubStats(): Agent['getStats'] {
  return () => ({
    promptTokens: 0,
    candidateTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    contextWindowSize: 0,
    contextWindowUsed: 0,
    turnCount: 0,
  });
}

function createBaseFakeAgent(gen: () => AsyncIterable<AgentEvent>): Agent {
  return {
    async chat() {
      throw new Error('not used');
    },
    async *stream() {
      yield* gen();
    },
    getProvider: () => 'test',
    async setProvider() {},
    getProviderStatus: () => ({
      provider: 'test',
      model: 'test',
      authStatus: 'authenticated',
    }),
    getModel: () => 'test',
    async setModel() {},
    getCurrentSequenceModel: () => 'test',
    getApprovalMode: () => 'default',
    setApprovalMode: () => {},
    getRuntimeId: () => 'test',
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: () => {},
    getEphemeralSettings: () => ({}),
    getModelParams: () => ({}),
    setModelParam: () => {},
    clearModelParam: () => {},
    getUserTier: () => undefined,
    profiles: {} as unknown as Agent['profiles'],
    tools: createStubTools(),
    mcp: {} as unknown as Agent['mcp'],
    auth: {} as unknown as Agent['auth'],
    ide: {} as unknown as Agent['ide'],
    session: {} as unknown as Agent['session'],
    hooks: {} as unknown as Agent['hooks'],
    policy: {} as unknown as Agent['policy'],
    tasks: {} as unknown as Agent['tasks'],
    memory: {} as unknown as Agent['memory'],
    skills: {} as unknown as Agent['skills'],
    workspace: {} as unknown as Agent['workspace'],
    lsp: {} as unknown as Agent['lsp'],
    async getHistory() {
      return [];
    },
    async setHistory() {},
    async addHistory() {},
    async restoreHistory() {},
    async resetChat() {},
    async updateSystemInstruction() {},
    async addDirectoryContext() {},
    async compress() {
      return { status: 'skipped' };
    },
    getStats: createStubStats(),
    onStats: () => () => {},
    async generate() {
      return '';
    },
    async generateJson() {
      return {};
    },
    async generateEmbedding() {
      return [];
    },
    listProviders: () => [],
    listTools: () => [],
    async dispose() {},
  } as unknown as Agent;
}
