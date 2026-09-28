/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createCodexResponsesWebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import {
  FakeSocket,
  SocketHarness,
  completingWithId,
  drain as drainHarness,
  frame,
  userTextsOf,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function buildNormalizedOptions(
  overrides: Partial<NormalizedGenerateChatOptions> = {},
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'test-runtime',
  });
  const config = createRuntimeConfigStub(settings, {});
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: {},
    fallbackRuntimeId: 'test-runtime',
  });

  const base = {
    contents: [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Hello' }],
      },
    ],
    settings,
    config,
    runtime,
    invocation,
    userMemory: undefined,
    tools: undefined,
    metadata: {},
    systemInstruction: 'test system prompt',
    resolved: {
      model: 'gpt-5.6-sol',
      baseURL: CODEX_BASE_URL,
      authToken: 'test-token',
    },
  } as unknown as NormalizedGenerateChatOptions;

  return { ...base, ...overrides };
}

function buildDeps(
  overrides: Partial<ResponsesExecutorDeps> = {},
): ResponsesExecutorDeps {
  return {
    providerName: 'openai-responses',
    logger: { debug: vi.fn() } as unknown as ResponsesExecutorDeps['logger'],
    getProviderBaseURL: () => CODEX_BASE_URL,
    getCustomHeaders: () => ({ 'X-Provider': 'p' }),
    isCodexMode: () => true,
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => 'codex-token',
    shouldRetryOnError: () => false,
    getDefaultModel: () => 'gpt-5.6-sol',
    getGlobalConfig: () => undefined,
    getMediaTransportCapabilities: (isCodex) =>
      declaredMediaTransportCapabilities(
        isCodex ? 'codex' : 'openai-responses',
      ),
    getUnallowedModelParameters: () => new Set<string>(),
    // Codex statefulness is WS-bound; this harness exercises the WS path.
    isWebSocketTransportActive: () => true,
    ...overrides,
  };
}

function multiParentHistory(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'first question' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'first answer' }],
      metadata: {
        id: 'resp_old',
        responsesStored: true,
        providerBaseURL: CODEX_BASE_URL,
      },
    },
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'second question' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'second answer' }],
      metadata: {
        id: 'resp_dead',
        responsesStored: true,
        providerBaseURL: CODEX_BASE_URL,
      },
    },
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'third question' }],
    },
  ];
}

function partText(part: unknown): string {
  if (typeof part === 'object' && part !== null && 'text' in part) {
    const text = part.text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

/**
 * Every input item's text (user AND assistant), so recovery assertions can
 * prove the FULL history was sent, not just the user-visible turns.
 */
function allInputTexts(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error('Expected a Responses "input" array');
  }
  return input.map((item) => {
    const content = (item as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    return Array.isArray(content) ? content.map(partText).join('') : '';
  });
}

describe('executeOpenAIResponsesRequest multi-parent recovery @issue:3446', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  it('recovers a multi-parent resumed history parentless over WebSocket: retires only the dead id, sends full history, and re-establishes the chain', async () => {
    // Resumed history carries TWO stored parents, both scoped to the lost
    // connection. The first send rejects on the dead NEWEST parent; the
    // recovery must NOT fall through to the older (equally dead) parent —
    // over WebSocket every stored parent may be connection-scoped, so it
    // rebuilds parentless while staying stateful (#3446).
    const parentNotFoundScript = (socket: FakeSocket) => {
      socket.open();
      let sends = 0;
      socket.onSend = () => {
        sends += 1;
        if (sends === 1) {
          socket.message(
            frame({
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: "Previous response with id 'resp_dead' not found.",
              },
            }),
          );
        }
      };
    };

    const harness = new SocketHarness([
      parentNotFoundScript,
      completingWithId('resp_fresh1', 'recovered'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const fetchSpy = vi.fn();
    setGlobal('fetch', fetchSpy);
    const rejected = new Set<string>();
    const markStatefulParentRejected = vi.fn((id: string) => {
      rejected.add(id);
    });
    const onWebSocketFallback = vi.fn();
    const onWebSocketSuccess = vi.fn();
    const deps = buildDeps({
      getWebSocketTransport: () => transport,
      isRejectedStatefulParent: (id) => rejected.has(id),
      markStatefulParentRejected,
      onWebSocketFallback,
      onWebSocketSuccess,
    });

    const first = await drainHarness(
      executeOpenAIResponsesRequest(
        buildNormalizedOptions({ contents: multiParentHistory() }),
        deps,
      ),
    );
    expect(first[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'recovered' }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onWebSocketFallback).not.toHaveBeenCalled();
    // Only the OBSERVED id is retired; the older parent is never sent.
    expect(markStatefulParentRejected).toHaveBeenCalledWith('resp_dead');
    expect(markStatefulParentRejected).not.toHaveBeenCalledWith('resp_old');
    expect(rejected).toStrictEqual(new Set(['resp_dead']));

    // Socket 1: the dead newest parent rides trimmed history.
    expect(harness.sockets).toHaveLength(2);
    expect(harness.sockets[0].closedByClient).toBe(true);
    const firstEnvelope = JSON.parse(harness.sockets[0].sent[0]) as Record<
      string,
      unknown
    >;
    expect(firstEnvelope['previous_response_id']).toBe('resp_dead');
    expect(userTextsOf(firstEnvelope['input'])).toStrictEqual([
      'third question',
    ]);

    // Socket 2: the recovery is parentless full history INCLUDING the
    // assistant turns — no fallthrough to the older stored parent.
    const recoveryEnvelope = JSON.parse(harness.sockets[1].sent[0]) as Record<
      string,
      unknown
    >;
    expect(recoveryEnvelope['previous_response_id']).toBeUndefined();
    const recoveryTexts = allInputTexts(recoveryEnvelope['input']);
    expect(recoveryTexts).toContain('first question');
    expect(recoveryTexts).toContain('first answer');
    expect(recoveryTexts).toContain('second question');
    expect(recoveryTexts).toContain('second answer');
    expect(recoveryTexts).toContain('third question');

    // The recovery response is stamped stored: the next turn chains from it.
    const recoveryMeta = first.find((message) => message.metadata)?.metadata;
    expect(recoveryMeta?.id).toBe('resp_fresh1');
    expect(recoveryMeta?.responsesStored).toBe(true);

    const next = await drainHarness(
      executeOpenAIResponsesRequest(
        buildNormalizedOptions({
          contents: [
            ...multiParentHistory(),
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'recovered' }],
              metadata: {
                id: 'resp_fresh1',
                responsesStored: true,
                providerBaseURL: CODEX_BASE_URL,
              },
            },
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'next question' }],
            },
          ],
        }),
        deps,
      ),
    );
    expect(next[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'recovered' }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    // No third socket: the recovery connection is reused for the chain.
    expect(harness.sockets).toHaveLength(2);
    const chained = JSON.parse(harness.sockets[1].sent[1]) as Record<
      string,
      unknown
    >;
    expect(chained['previous_response_id']).toBe('resp_fresh1');
    expect(userTextsOf(chained['input'])).toStrictEqual(['next question']);

    transport.close();
  });
});
