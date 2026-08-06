/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2150: a transient Anthropic "Connection error." that surfaces AFTER
 * the stream has begun (i.e. past the first-chunk retry boundary) must not
 * terminate the agent loop. Like any other transient network error it should
 * trigger a fresh turn-level retry rather than propagating as a fatal error
 * that breaks the loop back to the prompt.
 *
 * Root cause: TurnProcessor._runStreamAttempt only retried InvalidStreamError /
 * EmptyStreamError. Any other thrown error — including a transient network
 * error classified as retryable by isNetworkTransientError — fell through to
 * `{ action: 'stop' }`, which re-threw and broke the loop.
 *
 * These tests drive the REAL stack (ChatSession -> TurnProcessor ->
 * StreamProcessor) with a fake provider, using the real network-error
 * classifier (retry.ts is intentionally NOT mocked) so the behavior is
 * end-to-end and faithful to production.
 *
 * Issue #3048 replaced the post-output no-retry contract with
 * discard-and-restart: a transient transport failure that follows visible
 * output now restarts the turn once under the existing bounded budget. The
 * abort, non-transient, InvalidStreamError and EmptyStreamError cases below are
 * unchanged and are the regression fence for that boundary.
 */

import { describe, it, expect, beforeEach, vi } from '../testApi.js';
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
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  InvalidStreamError,
  EmptyStreamError,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import {
  RetryOrchestrator,
  type IProvider as ConcreteProvider,
} from '@vybestack/llxprt-code-providers';

describe('Issue 2150: transient connection error must retry the turn, not break the loop', () => {
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
      metadata: { source: 'chatSession.issue2150.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  function buildChatSession(history?: HistoryService): ChatSession {
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: 'stub',
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      // Use the caller-supplied HistoryService when provided so tests can
      // assert on the exact instance the session records into; otherwise
      // create a fresh one.
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

  /**
   * Builds the canonical Anthropic SDK connection error: message
   * "Connection error.", no HTTP status. isNetworkTransientError() classifies
   * this as retryable.
   */
  function createConnectionError(): Error {
    const error = new Error('Connection error.') as Error & {
      status?: number;
    };
    error.status = undefined;
    return error;
  }

  /**
   * Builds a non-transient HTTP 400 error that must NOT be retried.
   */
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

  it('restarts the turn after a connection error that followed visible content', async () => {
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      if (attempt === 1) {
        // First attempt: stream begins (first chunk lands inside the
        // first-chunk retry boundary) then a transient connection error is
        // thrown mid-stream.
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'partial' }],
        };
        throw createConnectionError();
      }
      // Second attempt: the turn is restarted from scratch and completes.
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'recovered response' }],
      };
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();

    const stream = await chat.sendMessageStream(
      { message: 'trigger mid-stream connection error' },
      'prompt-issue-2150-midstream',
    );

    const events = await collectEvents(stream);
    expect(attempt).toBe(2);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(2);
    const texts = events.flatMap((event) =>
      event.type === 'chunk'
        ? event.value.content.blocks
            .filter((block) => block.type === 'text')
            .map((block) => (block as { text: string }).text)
        : [],
    );
    expect(texts).toContain('recovered response');
  });

  it('restarts the turn after a connection error that followed a tool call', async () => {
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
              id: 'call-1',
              name: 'read_file',
              parameters: { file_path: 'README.md' },
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
      { message: 'trigger a tool call before a connection error' },
      'prompt-issue-2150-tool-call',
    );

    const events = await collectEvents(stream);
    expect(attempt).toBe(2);
    expect(events.some((event) => event.type === 'retry')).toBe(true);
  });

  it('restarts the turn after a connection error that followed hidden thinking metadata', async () => {
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
      { message: 'trigger hidden thinking metadata before a connection error' },
      'prompt-issue-2150-thinking-metadata',
    );

    const events = await collectEvents(stream);
    expect(attempt).toBe(2);
    expect(events.some((event) => event.type === 'retry')).toBe(true);
  });

  it('does NOT retry a non-transient error thrown mid-stream and stops the loop', async () => {
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
      { message: 'trigger non-transient error' },
      'prompt-issue-2150-nontransient',
    );

    // A non-transient error must still propagate (loop breaks) and must NOT be
    // retried, so the provider is invoked exactly once.
    expect(collectEvents(stream)).rejects.toThrow('Bad request');
    expect(attempt).toBe(1);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a user-initiated abort even though its message matches a transient phrase', async () => {
    let attempt = 0;
    const generateChatCompletionMock = vi.fn(async function* (
      _options: GenerateChatOptions,
    ) {
      attempt++;
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial' }],
      };
      // AbortError carries name 'AbortError'; its phrasing must never be
      // treated as a retryable transient network error.
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
      { message: 'trigger user abort' },
      'prompt-issue-2150-abort',
    );

    expect(collectEvents(stream)).rejects.toThrow('Request aborted');
    // The abort must terminate immediately without a retry.
    expect(attempt).toBe(1);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('stops retrying a persistently failing connection error after exhausting the restart budget', async () => {
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
      { message: 'trigger persistent connection error' },
      'prompt-issue-2150-persistent',
    );

    // One restart is permitted (maxAttempts: 2); a second failure propagates.
    expect(collectEvents(stream)).rejects.toThrow('Connection error.');
    expect(attempt).toBe(2);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry when the request was aborted via the abort signal (no AbortError name)', async () => {
    // This pins the SECOND abort-detection mechanism in isAbortError:
    // `params.config?.abortSignal?.aborted === true`. The thrown error carries
    // a transient-matching phrase ('terminated') but has neither name
    // 'AbortError' nor code 'ABORT_ERR', so only the aborted-signal check can
    // suppress the retry.
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
      // Mid-stream: the user cancels. Aborting here guarantees that by the
      // time _runStreamAttempt's catch runs, params.config.abortSignal.aborted
      // is true (the same params object flows into shouldRetryStreamAttempt).
      abortController.abort();
      // Transient phrase, but NO AbortError name and NO ABORT_ERR code.
      throw new Error('terminated');
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();

    const stream = await chat.sendMessageStream(
      {
        message: 'trigger abort via signal mid-stream',
        config: { abortSignal: abortController.signal },
      },
      'prompt-issue-2150-abort-signal',
    );

    // The error propagates; the aborted signal must suppress the retry.
    expect(collectEvents(stream)).rejects.toThrow('terminated');
    expect(attempt).toBe(1);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry an error carrying code ABORT_ERR even without AbortError name (Task A hardening)', async () => {
    // Pins the code === 'ABORT_ERR' branch added to isAbortError. The error
    // message matches a transient phrase ('terminated') and the object has
    // neither name 'AbortError' — only code 'ABORT_ERR'. Before Task A this
    // test would retry (attempt === 2); after Task A it must not.
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
      // Deliberately set ONLY the code, not the name, to exercise the new
      // branch in isolation.
      err.code = 'ABORT_ERR';
      throw err;
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();

    const stream = await chat.sendMessageStream(
      { message: 'trigger ABORT_ERR-coded error mid-stream' },
      'prompt-issue-2150-abort-code',
    );

    expect(collectEvents(stream)).rejects.toThrow('terminated');
    // The ABORT_ERR code must classify this as an abort and suppress retry.
    expect(attempt).toBe(1);
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('records only the successful attempt in history after a discard-and-restart', async () => {
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
      { message: 'history-safety trigger' },
      'prompt-issue-2150-history-safety',
    );

    const events = await collectEvents(stream);
    expect(attempt).toBe(2);
    expect(events.some((event) => event.type === 'retry')).toBe(true);

    await chat.waitForIdle();

    const ai = history.getAll().filter((content) => content.speaker === 'ai');
    expect(ai).toHaveLength(1);
    const aiText = ai[0].blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('');
    expect(aiText).toBe('recovered response');
    expect(aiText).not.toContain('partial');
  });

  it('does not retry InvalidStreamError after a chunk was already emitted', async () => {
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
      { message: 'trigger InvalidStreamError mid-stream' },
      'prompt-issue-2150-invalid-stream',
    );

    expect(collectEvents(stream)).rejects.toThrow(InvalidStreamError);
    expect(attempt).toBe(1);
  });

  it('does not retry EmptyStreamError after a chunk was already emitted', async () => {
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
        throw new EmptyStreamError('stream produced no content');
      }
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'recovered response' }],
      };
    });
    registerProvider(generateChatCompletionMock);

    const chat = buildChatSession();

    const stream = await chat.sendMessageStream(
      { message: 'trigger EmptyStreamError mid-stream' },
      'prompt-issue-2150-empty-stream',
    );

    expect(collectEvents(stream)).rejects.toThrow(EmptyStreamError);
    expect(attempt).toBe(1);
  });

  it('shares one transport budget across agent empty-stream retries', async () => {
    settingsService.set('retries', 1);
    let transports = 0;
    const delegate: ConcreteProvider = {
      name: 'stub',
      generateChatCompletion() {
        transports++;
        return (async function* (): AsyncGenerator<IContent> {
          yield* [];
        })();
      },
      getModels: async () => [],
      getDefaultModel: () => 'stub-model',
      getServerTools: () => [],
      invokeServerTool: async () => undefined,
    };
    const orchestrator = new RetryOrchestrator(delegate, {
      maxAttempts: 1,
      initialDelayMs: 0,
    });
    manager.registerProvider(orchestrator);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      { message: 'empty response' },
      'prompt-shared-transport-budget',
    );

    expect(collectEvents(stream)).rejects.toMatchObject({
      name: 'RetriesExhaustedError',
      category: 'server_error',
      isRetryable: false,
      shouldFailover: false,
      reason: 'retries_exhausted',
      cause: {
        name: 'EmptyStreamError',
      },
      failures: [
        {
          name: 'EmptyStreamError',
        },
      ],
    });
    expect(transports).toBe(1);
  });

  it('surfaces EmptyStreamError as the exhaustion cause with a single transport attempt recorded', async () => {
    // Complements the transport-count assertion above by pinning the error
    // shape that callers rely on for failover decisions: the wrapped cause is
    // the EmptyStreamError (not a generic transport error), the reason is
    // retries_exhausted, and the failures array records exactly one entry so
    // telemetry/bucket-failover logic can distinguish a shared-budget
    // exhaustion from a multi-attempt spiral.
    settingsService.set('retries', 1);
    const delegate: ConcreteProvider = {
      name: 'stub',
      generateChatCompletion() {
        return (async function* (): AsyncGenerator<IContent> {
          yield* [];
        })();
      },
      getModels: async () => [],
      getDefaultModel: () => 'stub-model',
      getServerTools: () => [],
      invokeServerTool: async () => undefined,
    };
    const orchestrator = new RetryOrchestrator(delegate, {
      maxAttempts: 1,
      initialDelayMs: 0,
    });
    manager.registerProvider(orchestrator);

    const chat = buildChatSession();
    const stream = await chat.sendMessageStream(
      { message: 'empty response' },
      'prompt-shared-transport-budget-error-shape',
    );

    let thrown: unknown;
    try {
      await collectEvents(stream);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const exhausted = thrown as Error & {
      reason?: string;
      cause?: Error;
      failures?: readonly Error[];
      message: string;
    };
    expect(exhausted.reason).toBe('retries_exhausted');
    expect(exhausted.cause).toBeInstanceOf(EmptyStreamError);
    expect(exhausted.failures).toHaveLength(1);
    expect(exhausted.failures?.[0]).toBeInstanceOf(EmptyStreamError);
    // The public message must surface the transport attempt count so
    // operators can tell a shared-budget exhaustion from a retry spiral.
    expect(exhausted.message).toContain('1 transport attempts');
  });
});
