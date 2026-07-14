/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core';

import { vi } from 'vitest';
import type {
  Agent,
  AgentEvent,
  AgentInput,
} from '@vybestack/llxprt-code-agents';
import { mapStreamEvent } from '@vybestack/llxprt-code-agents';

const coreMocks = vi.hoisted(() => {
  const mockSendMessageStream = vi
    .fn()
    .mockReturnValue((async function* () {})());
  const mockStartChat = vi.fn();
  const MockedAgentClientClass = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    _config: unknown,
  ) {
    this.startChat = mockStartChat;
    this.sendMessageStream = mockSendMessageStream;
    this.addHistory = vi.fn();
    this.getCurrentSequenceModel = vi.fn().mockReturnValue(null);
    this.getChat = vi.fn().mockReturnValue({
      recordCompletedToolCalls: vi.fn(),
    });
  });
  const MockedUserPromptEvent = vi.fn().mockImplementation(() => {});
  const mockParseAndFormatApiError = vi.fn();

  return {
    MockedAgentClientClass,
    MockedUserPromptEvent,
    mockParseAndFormatApiError,
    mockSendMessageStream,
    mockStartChat,
  };
});

export const MockedAgentClientClass = coreMocks.MockedAgentClientClass;
export const mockParseAndFormatApiError = coreMocks.mockParseAndFormatApiError;
export const mockSendMessageStream = coreMocks.mockSendMessageStream;
export const mockStartChat = coreMocks.mockStartChat;

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actualCoreModule = await importOriginal<Record<string, unknown>>();
  return {
    ...actualCoreModule,
    GitService: vi.fn(),
    AgentClient: coreMocks.MockedAgentClientClass,
    UserPromptEvent: coreMocks.MockedUserPromptEvent,
    parseAndFormatApiError: coreMocks.mockParseAndFormatApiError,
    tokenLimit: vi.fn().mockReturnValue(100),
  };
});

/**
 * Creates a minimal fake Agent that delegates history/model calls to a mock
 * AgentClientContract-like object. Used by useAgentStream test files that mock
 * the streaming internals (useReactToolScheduler, shellCommandProcessor).
 *
 * The fake Agent's stream() delegates to mockClient.sendMessageStream and maps
 * raw ServerAgentStreamEvents to public AgentEvents via mapStreamEvent. This
 * exercises the event-mapping layer but does NOT drive the real multi-turn loop
 * (no tool scheduling, no continuation, no confirmation bus). The real engine
 * integration tests live in
 * agentStream/__tests__/useAgentEventStream.loopIntegration.test.tsx.
 */
function extractInputText(input: AgentInput): string {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input
      .filter((p): p is { text: string } => typeof p?.text === 'string')
      .map((p) => p.text)
      .join('');
  }
  if ('text' in input) return input.text;
  return '';
}

function mapRawStream(
  rawStream: AsyncIterable<unknown>,
): AsyncIterable<AgentEvent> {
  return (async function* () {
    // Mirror the real mapLoopStream adapter state (eventAdapter.ts) so the
    // test helper's done-synthesis matches production behavior.
    const state: Parameters<typeof mapStreamEvent>[1] = {
      emittedDone: false,
      lastFinished: null,
      lastStop: null,
      pendingDoneReason: null,
      sawActivity: false,
    };
    for await (const rawEvent of rawStream) {
      // sawActivity gate: set true for any event that is not a standalone
      // AgentExecutionBlocked (mirrors eventAdapter.ts:405-410).
      const isStandaloneBlocked =
        (rawEvent as { type?: string }).type === 'AgentExecutionBlocked';
      if (!isStandaloneBlocked) {
        state.sawActivity = true;
      }
      for (const pub of mapStreamEvent(
        rawEvent as Parameters<typeof mapStreamEvent>[0],
        state,
      )) {
        if (pub.type === 'done') {
          state.emittedDone = true;
        }
        yield pub;
      }
    }
    // Loop-end done synthesis: only yield a synthetic done if we saw real
    // activity or have a pending done reason (mirrors eventAdapter.ts:415-427).
    if (
      !state.emittedDone &&
      (state.sawActivity || state.pendingDoneReason !== null)
    ) {
      const reason =
        state.pendingDoneReason ??
        (state.lastFinished?.stopReason === 'refusal' ? 'refusal' : 'stop');
      yield {
        type: 'done',
        reason,
        ...(state.lastFinished !== null
          ? { finished: state.lastFinished }
          : {}),
      } as AgentEvent;
    }
  })();
}

function createFakeStream(
  mockClient: Record<string, unknown>,
): (
  input: AgentInput,
  opts?: { readonly signal?: AbortSignal; readonly promptId?: string },
) => AsyncIterable<AgentEvent> {
  return async function* (input, opts) {
    const sendMessageStream = mockClient.sendMessageStream as
      | ((msg: string, sig: AbortSignal, pid: string) => AsyncIterable<unknown>)
      | undefined;
    if (typeof sendMessageStream !== 'function') {
      yield { type: 'done', reason: 'stop' } as AgentEvent;
      return;
    }
    const inputText = extractInputText(input);
    const raw = sendMessageStream(
      inputText,
      opts?.signal ?? new AbortController().signal,
      opts?.promptId ?? 'test',
    );
    yield* mapRawStream(raw);
  };
}

function createStubToolControl(): Agent['tools'] {
  return {
    list: () => [],
    get: () => undefined,
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

function createHistoryControl(mockClient: Record<string, unknown>) {
  return {
    async getHistory() {
      const fn = mockClient.getHistory as
        | (() => Promise<readonly unknown[]>)
        | undefined;
      return fn ? ((await fn()) as unknown as readonly IContent[]) : [];
    },
    async setHistory() {},
    async addHistory(message: unknown) {
      const fn = mockClient.addHistory as ((m: unknown) => void) | undefined;
      fn?.(message);
    },
    async restoreHistory() {},
    async resetChat() {
      const fn = mockClient.resetChat as (() => void) | undefined;
      fn?.();
    },
    async updateSystemInstruction() {},
    async addDirectoryContext() {},
  };
}

function createStatsControl() {
  return {
    getStats: () => ({
      promptTokens: 0,
      candidateTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
      turnCount: 0,
    }),
    onStats: () => () => {},
  };
}

function createBaseAgent(
  mockClient: Record<string, unknown>,
  streamFn: ReturnType<typeof createFakeStream>,
): Agent {
  return {
    async chat() {
      return { text: '', toolCalls: [], finishReason: 'stop' };
    },
    stream: streamFn,
    getProvider: () => 'test',
    async setProvider() {},
    getProviderStatus: () => ({
      provider: 'test',
      model: 'test',
      authStatus: 'authenticated',
    }),
    getModel: () =>
      (mockClient.getCurrentSequenceModel as (() => string) | undefined)?.() ??
      'test',
    async setModel() {},
    getCurrentSequenceModel: () =>
      (
        mockClient.getCurrentSequenceModel as (() => string | null) | undefined
      )?.() ?? null,
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
    tools: createStubToolControl(),
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
    ...createHistoryControl(mockClient),
    async compress() {
      return { status: 'skipped' };
    },
    ...createStatsControl(),
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

export function createFakeAgentFromMockClient(mockClient: unknown): Agent {
  return createBaseAgent(
    mockClient as Record<string, unknown>,
    createFakeStream(mockClient as Record<string, unknown>),
  );
}
