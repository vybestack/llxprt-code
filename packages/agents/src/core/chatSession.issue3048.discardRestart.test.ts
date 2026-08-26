/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3048: a transient transport failure that surfaces AFTER the model has
 * already emitted output (text, thinking, or a tool call) must trigger a
 * bounded discard-and-restart of the turn, not a fatal error. Every layer that
 * accumulated state for the abandoned attempt throws it away; the turn restarts
 * from a fresh StreamProcessor accumulator/history boundary under the existing
 * `INVALID_CONTENT_RETRY_OPTIONS` budget (exactly one restart per turn).
 *
 * Before output, the existing classification is unchanged: InvalidStreamError,
 * EmptyStreamError and transient network errors retry. After output, only a
 * transient transport failure (isNetworkTransientError) qualifies. Abort,
 * non-transient, terminal and exhausted cases still fail.
 *
 * These tests drive the REAL stack (ChatSession -> TurnProcessor ->
 * StreamProcessor) with a fake provider, using the real network-error
 * classifier (retry.ts is intentionally NOT mocked) so the behavior is
 * end-to-end and faithful to production. The only double is the provider's
 * generateChatCompletion async generator.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { ChatSession } from './chatSession.js';
import type { StreamEvent } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import {
  StreamEventType,
  InvalidStreamError,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';

describe('Issue 3048: discard-and-restart after a transient transport failure that followed partial output', () => {
  let settingsService: SettingsService;
  let config: Config;
  let manager: TestRuntimeProviderManager;
  let providerRuntime: ProviderRuntimeContext;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = new Config(createConfigParams(settingsService));

    settingsService.set('providers.stub.base-url', 'https://stub.example.com');
    settingsService.set('providers.stub.auth-key', 'stub-api-key');
    settingsService.set('providers.stub.model', 'stub-model');

    providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.runtime',
      metadata: { source: 'chatSession.issue3048.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  function buildChatSession(history?: HistoryService): ChatSession {
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test-3048',
      provider: 'stub',
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: history ?? new HistoryService(),
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    return new ChatSession(view, {} as unknown as ContentGenerator, {}, []);
  }

  function registerProvider(
    generateChatCompletion: (
      options: GenerateChatOptions,
    ) => AsyncGenerator<unknown>,
  ): IProvider {
    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion:
        generateChatCompletion as IProvider['generateChatCompletion'],
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    } as unknown as IProvider;
    manager.registerProvider(provider);
    return provider;
  }

  function createConnectionError(): Error {
    const error = new Error('Connection error.') as Error & {
      status?: number;
    };
    error.status = undefined;
    return error;
  }

  function createBadRequestError(): Error {
    const error = new Error('Bad request') as Error & { status?: number };
    error.status = 400;
    return error;
  }

  async function collectEvents(
    stream: AsyncGenerator<StreamEvent>,
  ): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  }

  /** Collects every text fragment carried by CHUNK stream events, in order. */
  function collectChunkText(events: readonly StreamEvent[]): string[] {
    const texts: string[] = [];
    for (const event of events) {
      if (event.type !== StreamEventType.CHUNK) continue;
      for (const block of event.value.content.blocks) {
        if (block.type === 'text' && block.text.length > 0) {
          texts.push(block.text);
        }
      }
    }
    return texts;
  }

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-002
   * @scenario Transient transport failure after partial output
   * @given attempt 1 yields 'partial' then throws Error('Connection error.')
   * @when the caller drains chat.sendMessageStream(...)
   * @then the provider is invoked twice and the stream completes
   * @and exactly one RETRY event precedes every attempt-2 chunk
   */
  it('restarts the turn after a transient transport failure that followed partial output', async () => {
    const {
      attempt,
      generateChatCompletionMock,
      retryIndices,
      postRetryTexts,
      preRetryTexts,
    } =
      await observeRestartsTheTurnAfterATransientTransportFailureThatFollowedPartialOutput();
    expect(attempt).toBe(2);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(2);
    expect(retryIndices).toHaveLength(1);
    expect(postRetryTexts).not.toContain('partial');
    expect(postRetryTexts).toContain('recovered response');
    expect(preRetryTexts).toContain('partial');
    expect(preRetryTexts).not.toContain('recovered response');
  });

  const observeRestartsTheTurnAfterATransientTransportFailureThatFollowedPartialOutput =
    async () => {
      let attempt = 0;
      const generateChatCompletionMock = vi.fn(async function* (
        _options: GenerateChatOptions,
      ) {
        attempt++;
        if (attempt === 1) {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'partial' }],
          };
          throw createConnectionError();
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'recovered response' }],
        };
      });
      registerProvider(generateChatCompletionMock);

      const chat = buildChatSession();
      const stream = await chat.sendMessageStream(
        { message: 'trigger mid-stream connection error' },
        'prompt-issue-3048-partial',
      );

      const events = await collectEvents(stream);

      const retryIndices = events
        .map((event, index) =>
          event.type === StreamEventType.RETRY ? index : -1,
        )
        .filter((index) => index >= 0);

      const retryIndex = retryIndices[0];

      // No chunk after the RETRY carries abandoned text; only recovered text.
      const postRetryTexts = collectChunkText(events.slice(retryIndex + 1));

      // No chunk before the RETRY carries the recovered text.
      const preRetryTexts = collectChunkText(events.slice(0, retryIndex));

      return {
        attempt,
        generateChatCompletionMock,
        retryIndices,
        postRetryTexts,
        preRetryTexts,
      };
    };

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-002
   * @scenario Transient transport failure after an abandoned tool_call block
   */
  it('restarts after an abandoned tool_call block', async () => {
    const {
      attempt,
      retryIndex,
      abandonedToolCallIds,
      replacementBlocks,
      restartsAfterAnAbandonedToolCallBlockObservation1,
    } = await observeRestartsAfterAnAbandonedToolCallBlock();
    expect(attempt).toBe(2);
    expect(retryIndex).toBeGreaterThanOrEqual(0);
    expect(abandonedToolCallIds).toStrictEqual([
      'abandoned-call-1',
      'abandoned-call-2',
    ]);
    expect(restartsAfterAnAbandonedToolCallBlockObservation1).toBe(true);
    expect(replacementBlocks.some((block) => block.type === 'tool_call')).toBe(
      false,
    );
  });

  const observeRestartsAfterAnAbandonedToolCallBlock = async () => {
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      if (attempt === 1) {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'abandoned-call-1',
              name: 'read_file',
              parameters: { file_path: 'README.md' },
            },
            {
              type: 'tool_call',
              id: 'abandoned-call-2',
              name: 'read_file',
              parameters: { file_path: 'CHANGELOG.md' },
            },
          ],
        };
        throw createConnectionError();
      }
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'recovered response' }],
      };
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      { message: 'trigger tool call before a connection error' },
      'prompt-issue-3048-tool-call',
    );

    const events = await collectEvents(stream);

    const retryIndex = events.findIndex(
      (event) => event.type === StreamEventType.RETRY,
    );

    const abandonedToolCallIds = events
      .slice(0, retryIndex)
      .flatMap((event) =>
        event.type === StreamEventType.CHUNK
          ? event.value.content.blocks.flatMap((block) =>
              block.type === 'tool_call' ? [block.id] : [],
            )
          : [],
      );

    const replacementBlocks = events
      .slice(retryIndex + 1)
      .flatMap((event) =>
        event.type === StreamEventType.CHUNK ? event.value.content.blocks : [],
      );

    const restartsAfterAnAbandonedToolCallBlockObservation1 =
      replacementBlocks.some(
        (block) => block.type === 'text' && block.text === 'recovered response',
      );
    return {
      attempt,
      retryIndex,
      abandonedToolCallIds,
      replacementBlocks,
      restartsAfterAnAbandonedToolCallBlockObservation1,
    };
  };

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-002
   * @scenario Transient transport failure after abandoned hidden thinking
   */
  it('restarts after abandoned hidden thinking metadata', async () => {
    const { attempt, events } =
      await observeRestartsAfterAbandonedHiddenThinkingMetadata();
    expect(attempt).toBe(2);
    expect(events.some((event) => event.type === StreamEventType.RETRY)).toBe(
      true,
    );
  });

  const observeRestartsAfterAbandonedHiddenThinkingMetadata = async () => {
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      if (attempt === 1) {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: '',
              sourceField: 'thinking',
              signature: 'state-token',
              streamId: 'reasoning-1',
              streamStatus: 'complete',
              isHidden: true,
            },
          ],
        };
        throw createConnectionError();
      }
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'recovered response' }],
      };
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      { message: 'trigger hidden thinking before a connection error' },
      'prompt-issue-3048-thinking',
    );

    const events = await collectEvents(stream);

    return { attempt, events };
  };

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-005
   * @scenario Durable history is the successful attempt alone
   */
  it('records only the successful attempt in history', async () => {
    const { ai, aiText, human } =
      await observeRecordsOnlyTheSuccessfulAttemptInHistory();
    expect(ai).toHaveLength(1);
    expect(aiText).toBe('recovered response');
    expect(aiText).not.toContain('partial');
    expect(human).toHaveLength(1);
  });

  const observeRecordsOnlyTheSuccessfulAttemptInHistory = async () => {
    const history = new HistoryService();
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      if (attempt === 1) {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'partial' }],
        };
        throw createConnectionError();
      }
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'recovered response' }],
      };
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession(history);
    const stream = await chat.sendMessageStream(
      { message: 'history-safety discard restart' },
      'prompt-issue-3048-history',
    );
    await collectEvents(stream);

    await chat.waitForIdle();

    const ai = history.getAll().filter((content) => content.speaker === 'ai');

    const aiText = ai[0].blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('');

    const human = history
      .getAll()
      .filter((content) => content.speaker === 'human');

    return { ai, aiText, human };
  };

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-003
   * @scenario Restart budget exhaustion still fails
   */
  it('fails after the restart budget is spent', async () => {
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial' }],
      };
      // Every attempt fails with the same transient connection error.
      throw createConnectionError();
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      { message: 'trigger persistent connection error after output' },
      'prompt-issue-3048-budget',
    );

    await expect(collectEvents(stream)).rejects.toThrow('Connection error.');
    expect(attempt).toBe(2);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(2);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-003
   * @scenario Non-transient failure after output does not restart
   */
  it('does not restart a non-transient failure after output', async () => {
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial' }],
      };
      throw createBadRequestError();
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      { message: 'trigger non-transient error after output' },
      'prompt-issue-3048-nontransient',
    );

    await expect(collectEvents(stream)).rejects.toThrow('Bad request');
    expect(attempt).toBe(1);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-003
   * @scenario Content-validity verdict after output is not a transport failure
   */
  it('does not restart an InvalidStreamError raised after output', async () => {
    const { stream, observation, generateChatCompletionMock } =
      await observeDoesNotRestartAnInvalidStreamErrorRaisedAfterOutput();
    await expect(collectEvents(stream)).rejects.toThrow(InvalidStreamError);
    expect(observation.attempt).toBe(1);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
  });

  const observeDoesNotRestartAnInvalidStreamErrorRaisedAfterOutput =
    async () => {
      const observation = { attempt: 0 };
      const generateChatCompletionMock = vi.fn(async function* (
        _options: GenerateChatOptions,
      ) {
        observation.attempt++;
        if (observation.attempt === 1) {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'partial' }],
          };
          throw new InvalidStreamError(
            'stream produced no usable text',
            'NO_RESPONSE_TEXT',
          );
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'recovered response' }],
        };
      });
      registerProvider(generateChatCompletionMock);

      const chat = buildChatSession();
      const stream = await chat.sendMessageStream(
        { message: 'trigger InvalidStreamError after output' },
        'prompt-issue-3048-invalid-stream',
      );

      return { stream, observation, generateChatCompletionMock };
    };

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-004
   * @scenario Abort wins even after output, on every abort mechanism
   */
  it('does not restart when the failure is an abort (name + code) after output', async () => {
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial' }],
      };
      const abortError = new Error('Request aborted') as Error & {
        code?: string;
      };
      abortError.name = 'AbortError';
      abortError.code = 'ABORT_ERR';
      throw abortError;
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      { message: 'trigger abort after output' },
      'prompt-issue-3048-abort',
    );

    await expect(collectEvents(stream)).rejects.toThrow('Request aborted');
    expect(attempt).toBe(1);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('does not restart on an ABORT_ERR code (without AbortError name) after output', async () => {
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial' }],
      };
      const err = new Error('terminated') as Error & { code?: string };
      err.code = 'ABORT_ERR';
      throw err;
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      { message: 'trigger ABORT_ERR code after output' },
      'prompt-issue-3048-abort-code',
    );

    await expect(collectEvents(stream)).rejects.toThrow('terminated');
    expect(attempt).toBe(1);
  });

  it('does not restart when the abort signal fired (transient phrase, no abort name/code) after output', async () => {
    const abortController = new AbortController();
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial' }],
      };
      abortController.abort();
      throw new Error('terminated');
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      {
        message: 'trigger aborted signal after output',
        config: { abortSignal: abortController.signal },
      },
      'prompt-issue-3048-abort-signal',
    );

    await expect(collectEvents(stream)).rejects.toThrow('terminated');
    expect(attempt).toBe(1);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P02
   * @requirement REQ-3048-011
   * @scenario Eagerly recorded tool-response ids survive the discard
   * @given a tool response is eagerly recorded before the next send, and the
   *        next turn's message carries that same tool_response, and the stream
   *        restarts once after a transient failure following partial output
   * @then the final history contains exactly one tool_response block for that
   *       callId (not a duplicate from the successful attempt)
   */
  it('keeps eagerly recorded tool-response ids across a discard', async () => {
    const { attempt, toolResponseCount } =
      await observeKeepsEagerlyRecordedToolResponseIdsAcrossADiscard();
    expect(attempt).toBe(2);
    expect(toolResponseCount).toBe(1);
  });

  const observeKeepsEagerlyRecordedToolResponseIdsAcrossADiscard = async () => {
    const history = new HistoryService();
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      if (attempt === 1) {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'partial' }],
        };
        throw createConnectionError();
      }
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Done.' }],
      };
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession(history);

    const completed = [
      {
        status: 'success' as const,
        request: {
          callId: 'toolu_eager_1',
          name: 'read_file',
          args: { file_path: '/test/package.json' },
          prompt_id: 'prompt-eager-1',
          agentId: 'default_agent',
          isClientInitiated: false,
        },
        response: {
          callId: 'toolu_eager_1',
          responseParts: [
            {
              type: 'tool_call',
              id: 'toolu_eager_1',
              name: 'read_file',
              parameters: { file_path: '/test/package.json' },
            },
            {
              type: 'tool_response',
              callId: 'toolu_eager_1',
              toolName: 'read_file',
              result: { output: 'package-json' },
            },
          ],
          resultDisplay: 'package-json',
        },
        invocation: { execute: vi.fn() },
      },
    ];
    chat.recordCompletedToolCalls('stub-model', completed);

    const stream = await chat.sendMessageStream(
      {
        message: {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_eager_1',
              toolName: 'read_file',
              result: { output: 'package-json' },
            },
            { type: 'text', text: 'Continue with the analysis.' },
          ],
        },
      },
      'prompt-eager-1',
    );
    await collectEvents(stream);

    await chat.waitForIdle();

    const toolResponseCount = history
      .getAll()
      .reduce(
        (count, content) =>
          count +
          content.blocks.filter(
            (block) =>
              block.type === 'tool_response' &&
              (block as { callId?: string }).callId === 'toolu_eager_1',
          ).length,
        0,
      );

    return { attempt, toolResponseCount };
  };
});
