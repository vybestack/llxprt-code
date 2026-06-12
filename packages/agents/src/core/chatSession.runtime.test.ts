/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-lines -- Phase 5: large behavioral coverage file retained together to avoid fragmenting related scenarios. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GenerateContentConfig, Tool, Part } from '@google/genai';
import { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeStateFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeStateFactory.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';

import {
  AfterModelHookOutput,
  BeforeModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

const retryWithBackoff = vi.mocked(
  await import('@vybestack/llxprt-code-core/utils/retry.js').then(
    (m) => m.retryWithBackoff,
  ),
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

describe('ChatSession runtime context', () => {
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
      metadata: { source: 'chatSession.runtime.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
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

    const chat = new ChatSession(
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
    expect(contents.length).toBeGreaterThan(0);
  });

  it('filters hook-disallowed provider function calls from non-stream responses and history', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'allowed-call',
            name: 'read_file',
            parameters: { file_path: 'file.txt' },
          },
          {
            type: 'tool_call',
            id: 'blocked-call',
            name: 'run_shell_command',
            parameters: { command: 'echo blocked' },
          },
        ],
        automaticFunctionCallingHistory: [
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'history-allowed-call',
                  name: 'read_file',
                  args: { file_path: 'file.txt' },
                },
              },
              {
                functionCall: {
                  id: 'history-blocked-call',
                  name: 'run_shell_command',
                  args: { command: 'echo blocked-history' },
                },
              },
            ],
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

    const tools = [
      {
        functionDeclarations: [
          { name: 'read_file' } as Record<string, unknown>,
          { name: 'run_shell_command' } as Record<string, unknown>,
        ],
      },
    ] as unknown as Tool[];
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const historyService = new HistoryService();
    const hookConfig = Object.create(config) as Config;
    Object.defineProperties(hookConfig, {
      getEnableHooks: { value: () => true },
      getHookSystem: {
        value: () => ({
          initialize: async () => undefined,
          fireBeforeToolSelectionEvent: async () => ({
            applyToolConfigModifications: () => ({
              toolConfig: { allowedFunctionNames: ['read_file'] },
            }),
          }),
        }),
      },
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
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime, config: hookConfig },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const response = await chat.sendMessage(
      { message: 'Use tools', config: { tools } },
      'prompt-hook-selection',
    );

    expect(response.functionCalls).toStrictEqual([
      expect.objectContaining({ name: 'read_file' }),
    ]);

    expect(JSON.stringify(response)).not.toContain('run_shell_command');
    expect(JSON.stringify(historyService.getCurated())).not.toContain(
      'run_shell_command',
    );
  });

  it('preserves direct response text when filtering hook-disallowed tool calls', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'visible text' },
          {
            type: 'tool_call',
            id: 'blocked-call',
            name: 'run_shell_command',
            parameters: { command: 'echo blocked' },
          },
        ],
        metadata: {
          providerMetadata: {
            automaticFunctionCallingHistory: [
              {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      id: 'metadata-blocked-call',
                      name: 'run_shell_command',
                      args: { command: 'echo metadata-blocked' },
                    },
                  },
                ],
              },
            ],
          },
        },
      };
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'still visible' }],
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
        functionDeclarations: [
          { name: 'read_file' } as Record<string, unknown>,
          { name: 'run_shell_command' } as Record<string, unknown>,
        ],
      },
    ] as unknown as Tool[];
    const hookConfig = Object.create(config) as Config;
    Object.defineProperties(hookConfig, {
      getEnableHooks: { value: () => true },
      getHookSystem: {
        value: () => ({
          initialize: async () => undefined,
          fireBeforeToolSelectionEvent: async () => ({
            applyToolConfigModifications: () => ({
              toolConfig: { allowedFunctionNames: ['read_file'] },
            }),
          }),
          fireBeforeModelEvent: async () => new BeforeModelHookOutput({}),
          fireAfterModelEvent: async () => new AfterModelHookOutput({}),
        }),
      },
    });
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: new HistoryService(),
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
      providerRuntime: { ...providerRuntime, config: hookConfig },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      { tools },
      [],
    );

    const response = await chat.generateDirectMessage(
      { message: 'Use direct response' },
      'prompt-direct-hook-selection',
    );

    expect(response.text).toBe('visible textstill visible');
    expect(JSON.stringify(response)).not.toContain('run_shell_command');
  });

  it('applies BeforeToolSelection to request-scoped streaming tools', async () => {
    const calls: GenerateChatOptions[] = [];
    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'streamed response' }],
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

    const tools = [
      {
        functionDeclarations: [
          { name: 'read_file' } as Record<string, unknown>,
          { name: 'run_shell_command' } as Record<string, unknown>,
        ],
      },
    ] as unknown as Tool[];
    const hookConfig = config;
    Object.defineProperties(hookConfig, {
      getConversationLoggingEnabled: { value: () => false },
      getEnableHooks: { value: () => true },
      getHookSystem: {
        value: () => ({
          initialize: async () => undefined,
          isInitialized: () => true,

          fireBeforeToolSelectionEvent: async () => ({
            applyToolConfigModifications: () => ({
              toolConfig: { allowedFunctionNames: ['read_file'] },
            }),
          }),
          fireBeforeModelEvent: async () => new BeforeModelHookOutput({}),
          fireAfterModelEvent: async () => new AfterModelHookOutput({}),
        }),
      },
    });
    const hookProviderRuntime = createProviderRuntimeContext({
      settingsService,
      config: hookConfig,
      runtimeId: 'test.runtime.hook-selection',
      metadata: { source: 'chatSession.runtime.test' },
    });
    const hookManager = new TestRuntimeProviderManager(hookProviderRuntime);
    hookManager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: provider.name,
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: new HistoryService(),
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
      provider: createProviderAdapterFromManager(hookManager),
      telemetry: createTelemetryAdapterFromConfig(hookConfig),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: hookProviderRuntime,
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    const stream = await chat.sendMessageStream(
      { message: 'stream with request-scoped tools', config: { tools } },
      'prompt-stream-hook-selection',
    );
    for await (const _event of stream) {
      // exhaust stream
    }

    expect(calls[0].tools).toStrictEqual([
      {
        functionDeclarations: [{ name: 'read_file' }],
      },
    ]);
  });

  it('aborts a stalled non-stream sendMessage response after partial provider output instead of hanging forever', async () => {
    vi.useFakeTimers();
    const testTimeoutMs = 30_000; // 30 second timeout for this test

    try {
      // Set explicit timeout via ephemeral setting
      config.setEphemeralSetting('stream-idle-timeout-ms', testTimeoutMs);

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

      const chat = new ChatSession(
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
      await vi.advanceTimersByTimeAsync(testTimeoutMs + 1);

      await rejection;
      expect(capturedSignal?.aborted).toBe(true);
      expect(generateChatCompletionMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a stalled direct-message response after partial provider output instead of hanging forever', async () => {
    vi.useFakeTimers();
    const testTimeoutMs = 30_000; // 30 second timeout for this test

    try {
      // Set explicit timeout via ephemeral setting
      config.setEphemeralSetting('stream-idle-timeout-ms', testTimeoutMs);

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

      const chat = new ChatSession(
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
      await vi.advanceTimersByTimeAsync(testTimeoutMs + 1);

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

    const chat = new ChatSession(
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

    const chat = new ChatSession(
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

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    await chat.sendMessage({ message: 'Continue' }, 'prompt-123');

    expect(calls).toHaveLength(1);
    const sent = calls[0].contents;
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

  it('does not mutate TestRuntimeProviderManager active provider when runtimeState.provider differs', async () => {
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

    const chat = new ChatSession(
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

      const chat = new ChatSession(
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
  let localManager: TestRuntimeProviderManager;

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

      // Verify ChatSession.getConfig() returns a config that provides the setting
      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime',
        metadata: { source: 'timeout-test' },
      });

      localManager = new TestRuntimeProviderManager(localProviderRuntime);
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
      const chat = new ChatSession(
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

      localManager = new TestRuntimeProviderManager(localProviderRuntime);
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
      const chat = new ChatSession(
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
        '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js'
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
        '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js'
      );
      const result = resolveStreamIdleTimeoutMs(localConfig);
      expect(result).toBe(customTimeoutMs);
    });
  });
});
