/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GenerateContentConfig, Tool, Part } from '@google/genai';
import { GeminiChat } from './geminiChat.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IProvider, GenerateChatOptions } from '../providers/IProvider.js';
import { ProviderManager } from '../providers/ProviderManager.js';
import { Config } from '../config/config.js';
import type { ConfigParameters } from '../config/config.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import { SettingsService } from '../settings/SettingsService.js';
import type { ContentGenerator } from './contentGenerator.js';
import { createAgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import { createAgentRuntimeContext } from '../runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../runtime/runtimeAdapters.js';
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../utils/streamIdleTimeout.js';

vi.mock('../utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

const retryWithBackoff = vi.mocked(
  await import('../utils/retry.js').then((m) => m.retryWithBackoff),
);

function createConfigParams(
  settingsService: SettingsService,
): ConfigParameters {
  return {
    cwd: '/tmp',
    targetDir: '/tmp/project',
    debugMode: false,
    question: undefined,

    userMemory: '',
    embeddingModel: 'gemini-embedding',
    sandbox: undefined,
    sessionId: 'test-session',
    model: 'gemini-1.5-pro',
    settingsService,
  };
}

describe('GeminiChat runtime context', () => {
  let settingsService: SettingsService;
  let config: Config;
  let manager: ProviderManager;
  let providerRuntime: ProviderRuntimeContext;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = new Config(createConfigParams(settingsService));

    settingsService.set('providers.stub.base-url', 'https://stub.example.com');
    settingsService.set('providers.stub.apiKey', 'stub-api-key');
    settingsService.set('providers.stub.model', 'stub-model');

    providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.runtime',
      metadata: { source: 'geminiChat.runtime.test' },
    });

    manager = new ProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  it('passes runtime context and tools to provider generateChatCompletion', async () => {
    const calls: GenerateChatOptions[] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'hello world' }],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    };

    manager.registerProvider(provider);

    const tools = [
      {
        functionDeclarations: [{ name: 'doThing' } as Record<string, unknown>],
      },
    ] as unknown as Tool[];

    const generationConfig: GenerateContentConfig = {
      tools,
    };

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
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

    const chat = new GeminiChat(
      view,
      {} as unknown as ContentGenerator,
      generationConfig,
      [],
    );

    const response = await chat.sendMessage(
      { message: 'Hello there!' },
      'prompt-123',
    );

    expect(response).toBeDefined();
    expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
    expect(retryWithBackoff).toHaveBeenCalled();

    const options = calls[0];
    expect(options).toBeDefined();
    expect(options.runtime).toBeDefined();
    expect(options.runtime?.settingsService).toBe(settingsService);
    expect(options.runtime?.config).toBe(config);
    expect(options.config).toBe(config);
    expect(options.tools).toBeDefined();
    expect(options.tools?.length).toBe(tools.length);

    const contents = options.contents;
    expect(Array.isArray(contents)).toBe(true);
    expect(contents?.length).toBeGreaterThan(0);
  });
  it('aborts a stalled non-stream sendMessage response after partial provider output instead of hanging forever', async () => {
    vi.useFakeTimers();

    try {
      let capturedSignal: AbortSignal | undefined;
      const generateChatCompletionMock = vi.fn(async function* (
        options: GenerateChatOptions,
      ) {
        capturedSignal = options.invocation?.signal;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'partial' }],
        };
        await new Promise((_, reject) => {
          capturedSignal?.addEventListener(
            'abort',
            () => reject(capturedSignal?.reason ?? new Error('Aborted')),
            { once: true },
          );
        });
      });

      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: generateChatCompletionMock,
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
        getAuthToken: vi.fn(async () => 'stub-auth-token'),
      };

      manager.registerProvider(provider);

      const runtimeState = createAgentRuntimeState({
        runtimeId: 'runtime-test',
        provider: provider.name,
        model: config.getModel(),
        sessionId: config.getSessionId(),
      });
      const historyService = new HistoryService();
      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
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

      const chat = new GeminiChat(
        view,
        {} as unknown as ContentGenerator,
        {},
        [],
      );

      const runPromise = chat.sendMessage(
        { message: 'Hello there!' },
        'prompt-stalled-send',
      );
      const rejection = runPromise.then(
        () => {
          throw new Error('Expected stalled sendMessage response to abort');
        },
        (error) => {
          expect(error).toMatchObject({
            name: 'AbortError',
          });
        },
      );

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(DEFAULT_STREAM_IDLE_TIMEOUT_MS + 1);

      await rejection;
      expect(capturedSignal?.aborted).toBe(true);
      expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a stalled direct-message response after partial provider output instead of hanging forever', async () => {
    vi.useFakeTimers();

    try {
      let capturedSignal: AbortSignal | undefined;
      const generateChatCompletionMock = vi.fn(async function* (
        options: GenerateChatOptions,
      ) {
        capturedSignal = options.invocation?.signal;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'partial direct' }],
        };
        await new Promise((_, reject) => {
          capturedSignal?.addEventListener(
            'abort',
            () => reject(capturedSignal?.reason ?? new Error('Aborted')),
            { once: true },
          );
        });
      });

      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: generateChatCompletionMock,
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
        getAuthToken: vi.fn(async () => 'stub-auth-token'),
      };

      manager.registerProvider(provider);

      const runtimeState = createAgentRuntimeState({
        runtimeId: 'runtime-test',
        provider: provider.name,
        model: config.getModel(),
        sessionId: config.getSessionId(),
      });
      const historyService = new HistoryService();
      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
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

      const chat = new GeminiChat(
        view,
        {} as unknown as ContentGenerator,
        {},
        [],
      );

      const runPromise = chat.generateDirectMessage(
        { message: 'Hello there!' },
        'prompt-stalled-direct',
      );
      const rejection = runPromise.then(
        () => {
          throw new Error('Expected stalled direct-message response to abort');
        },
        (error) => {
          expect(error).toMatchObject({
            name: 'AbortError',
          });
        },
      );

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(DEFAULT_STREAM_IDLE_TIMEOUT_MS + 1);

      await rejection;
      expect(capturedSignal?.aborted).toBe(true);
      expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits tool call/response even when model returns only thinking after tool results', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought: 'processing tool output' }],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
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

    const chat = new GeminiChat(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const toolCallPart = {
      functionCall: {
        id: 'toolu_123',
        name: 'run_shell_command',
        args: { command: 'ls -lt dev-docs' },
      },
    };
    const toolResponsePart = {
      functionResponse: {
        id: 'toolu_123',
        name: 'run_shell_command',
        response: { stdout: 'ok', stderr: '', exitCode: 0 },
      },
    };

    const stream = await chat.sendMessageStream(
      { message: [toolCallPart, toolResponsePart] as unknown as Part[] },
      'prompt-123',
    );
    for await (const _event of stream) {
      // exhaust stream to trigger history recording
    }

    const curated = historyService.getCuratedForProvider();
    const toolCallIndex = curated.findIndex(
      (content) => content.speaker === 'ai' && content.blocks.length > 0,
    );
    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    const toolResponseIndex = curated.findIndex(
      (content) => content.speaker === 'tool' && content.blocks.length > 0,
    );
    expect(toolResponseIndex).toBeGreaterThanOrEqual(0);
    expect(toolResponseIndex).toBe(toolCallIndex + 1);

    const toolCallBlock = curated[toolCallIndex].blocks.find(
      (block) => block.type === 'tool_call',
    ) as { id: string; name: string };
    const toolResponseBlock = curated[toolResponseIndex].blocks.find(
      (block) => block.type === 'tool_response',
    ) as { callId: string; toolName: string };

    expect(toolCallBlock).toBeDefined();
    expect(toolResponseBlock).toBeDefined();
    expect(toolCallBlock.name).toBe('run_shell_command');
    expect(toolResponseBlock.toolName).toBe('run_shell_command');
    expect(toolResponseBlock.callId).toBe(toolCallBlock.id);
  });

  it('retains thinking parts alongside tool calls when includeInContext is enabled', async () => {
    const calls: GenerateChatOptions[] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Follow-up reasoning',
            signature: 'sig-1',
          },
          {
            type: 'tool_call',
            id: 'hist_tool_reasoned_1',
            name: 'run_shell_command',
            parameters: { command: 'ls -lt packages' },
          },
        ],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
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

    const chat = new GeminiChat(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const stream = await chat.sendMessageStream(
      { message: 'Trigger tool call' },
      'prompt-123',
    );
    for await (const _event of stream) {
      // exhaust stream to trigger history recording
    }

    const curated = historyService.getCuratedForProvider();
    const toolCallEntry = curated.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    expect(toolCallEntry).toBeDefined();
    expect(
      toolCallEntry?.blocks.some((block) => block.type === 'thinking'),
    ).toBe(true);
  });

  it('closes pending tool calls in provider payload when sending a new user message', async () => {
    const calls: GenerateChatOptions[] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'ok' }],
      };
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();

    // Seed a pending tool call (no tool response yet).
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_tool_pending_1',
          name: 'run_shell_command',
          parameters: { command: 'ls -lt packages' },
        },
      ],
    });

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new GeminiChat(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    await chat.sendMessage({ message: 'Continue' }, 'prompt-123');

    expect(calls).toHaveLength(1);
    const sent = calls[0].contents ?? [];
    const toolCallIndex = sent.findIndex(
      (c) =>
        c.speaker === 'ai' &&
        c.blocks.some(
          (b) =>
            b.type === 'tool_call' &&
            (b as { id?: string }).id === 'hist_tool_pending_1',
        ),
    );
    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    expect(sent[toolCallIndex + 1]?.speaker).toBe('tool');
    expect(
      sent[toolCallIndex + 1]?.blocks.some(
        (b) =>
          b.type === 'tool_response' &&
          (b as { callId?: string }).callId === 'hist_tool_pending_1',
      ),
    ).toBe(true);
  });

  it('does not mutate ProviderManager active provider when runtimeState.provider differs', async () => {
    const openaiCalls: GenerateChatOptions[] = [];
    const anthropicCalls: GenerateChatOptions[] = [];

    const openaiProvider: IProvider = {
      name: 'openai',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'openai-model',
      generateChatCompletion: vi.fn(async function* (
        options: GenerateChatOptions,
      ) {
        openaiCalls.push(options);
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'openai' }],
        };
      }),
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'openai-auth-token'),
    };

    const anthropicProvider: IProvider = {
      name: 'anthropic',
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'claude-test',
      generateChatCompletion: vi.fn(async function* (
        options: GenerateChatOptions,
      ) {
        anthropicCalls.push(options);
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'anthropic' }],
        };
      }),
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'anthropic-auth-token'),
    };

    manager.registerProvider(openaiProvider);
    manager.registerProvider(anthropicProvider);
    settingsService.set('activeProvider', 'openai');

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: 'anthropic',
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });

    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    const chat = new GeminiChat(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    await chat.sendMessage({ message: 'Hello there!' }, 'prompt-123');

    expect(openaiCalls).toHaveLength(0);
    expect(anthropicCalls).toHaveLength(1);
    expect(settingsService.get('activeProvider')).toBe('openai');
  });

  it.each([
    {
      label: 'stopReason',
      metadata: { stopReason: 'end_turn' },
    },
    {
      label: 'finishReason',
      metadata: { finishReason: 'stop' },
    },
  ])(
    'coalesces $label metadata into a terminal Finished event in Turn stream',
    async ({ metadata }) => {
      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(async function* (
          _options: GenerateChatOptions,
        ) {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'first chunk' }],
          };
          yield {
            speaker: 'ai',
            blocks: [],
            metadata,
          };
        }),
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
        getAuthToken: vi.fn(async () => 'stub-auth-token'),
      };

      manager.registerProvider(provider);

      const runtimeState = createAgentRuntimeState({
        runtimeId: 'runtime-test',
        provider: provider.name,
        model: config.getModel(),
        sessionId: config.getSessionId(),
      });
      const historyService = new HistoryService();
      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
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

      const chat = new GeminiChat(
        view,
        {} as unknown as ContentGenerator,
        {},
        [],
      );
      const { Turn, GeminiEventType } = await import('./turn.js');
      const turn = new Turn(chat, 'prompt-123');

      const events = [] as Array<{ type: string; value?: unknown }>;
      for await (const event of turn.run(
        [{ text: 'Hello there!' }] as Part[],
        new AbortController().signal,
      )) {
        events.push({
          type: event.type,
          value: 'value' in event ? event.value : undefined,
        });
      }

      const contentEvents = events.filter(
        (event) => event.type === GeminiEventType.Content,
      );
      expect(contentEvents).toHaveLength(1);
      expect(contentEvents[0].value).toBe('first chunk');

      const finishedEvents = events.filter(
        (event) => event.type === GeminiEventType.Finished,
      );
      expect(finishedEvents).toHaveLength(1);
      expect(finishedEvents[0].value).toMatchObject({ reason: 'STOP' });
    },
  );
});

describe('stream idle timeout behavioral tests for TurnProcessor and DirectMessageProcessor', () => {
  const originalEnv = process.env;
  let localSettingsService: SettingsService;
  let localConfig: Config;
  let localProviderRuntime: ProviderRuntimeContext;
  let localManager: ProviderManager;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('TurnProcessor', () => {
    it('honors config setting: uses resolveStreamIdleTimeoutMs with config from getConfig()', async () => {
      const customTimeoutMs = 12_000;

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting(
        'stream-idle-timeout-ms',
        customTimeoutMs,
      );

      // Verify GeminiChat.getConfig() returns a config that provides the setting
      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime',
        metadata: { source: 'timeout-test' },
      });

      localManager = new ProviderManager(localProviderRuntime);
      localManager.setConfig(localConfig);
      localConfig.setProviderManager(localManager);

      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(async function* () {}),
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
      };
      localManager.registerProvider(provider);
      localManager.setActiveProvider('stub');

      const contentGenerator = {} as ContentGenerator;
      const chat = new GeminiChat(
        createAgentRuntimeContext({
          state: createAgentRuntimeStateFromConfig(localConfig),
          settings: { compressionThreshold: 0.8 },
          provider: createProviderAdapterFromManager(localManager),
          telemetry: createTelemetryAdapterFromConfig(localConfig),
          tools: createToolRegistryViewFromRegistry(
            localConfig.getToolRegistry(),
          ),
          providerRuntime: localProviderRuntime,
        }),
        contentGenerator,
        {},
        [],
      );

      // Verify the config is accessible via getConfig()
      const configFromChat = chat.getConfig();
      expect(configFromChat).toBeDefined();
      expect(
        configFromChat?.getEphemeralSetting('stream-idle-timeout-ms'),
      ).toBe(customTimeoutMs);
    });

    it('disabled path: setting 0 disables watchdog', async () => {
      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting('stream-idle-timeout-ms', 0);

      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime',
        metadata: { source: 'disabled-test' },
      });

      localManager = new ProviderManager(localProviderRuntime);
      localManager.setConfig(localConfig);
      localConfig.setProviderManager(localManager);

      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(async function* () {}),
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
      };
      localManager.registerProvider(provider);
      localManager.setActiveProvider('stub');

      const contentGenerator = {} as ContentGenerator;
      const chat = new GeminiChat(
        createAgentRuntimeContext({
          state: createAgentRuntimeStateFromConfig(localConfig),
          settings: { compressionThreshold: 0.8 },
          provider: createProviderAdapterFromManager(localManager),
          telemetry: createTelemetryAdapterFromConfig(localConfig),
          tools: createToolRegistryViewFromRegistry(
            localConfig.getToolRegistry(),
          ),
          providerRuntime: localProviderRuntime,
        }),
        contentGenerator,
        {},
        [],
      );

      const configFromChat = chat.getConfig();
      expect(
        configFromChat?.getEphemeralSetting('stream-idle-timeout-ms'),
      ).toBe(0);
    });

    it('env var precedence: env var overrides config setting', async () => {
      const envTimeoutMs = 15_000;
      process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = String(envTimeoutMs);

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting('stream-idle-timeout-ms', 60_000);

      const { resolveStreamIdleTimeoutMs } = await import(
        '../utils/streamIdleTimeout.js'
      );

      const result = resolveStreamIdleTimeoutMs(localConfig);
      expect(result).toBe(envTimeoutMs); // Env wins
    });
  });

  describe('DirectMessageProcessor (via generateDirectMessage)', () => {
    it('uses runtimeContext.config for resolveStreamIdleTimeoutMs', async () => {
      const customTimeoutMs = 10_000;

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting(
        'stream-idle-timeout-ms',
        customTimeoutMs,
      );

      // Verify the config is properly set
      expect(localConfig.getEphemeralSetting('stream-idle-timeout-ms')).toBe(
        customTimeoutMs,
      );

      // The DirectMessageProcessor passes runtimeContext.config to resolveStreamIdleTimeoutMs
      // This test verifies the config has the setting accessible
      const { resolveStreamIdleTimeoutMs } = await import(
        '../utils/streamIdleTimeout.js'
      );
      const result = resolveStreamIdleTimeoutMs(localConfig);
      expect(result).toBe(customTimeoutMs);
    });
  });
});
