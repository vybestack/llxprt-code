/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Streaming and abort behaviors for ChatSession runtime context.
 * Sibling to chatSession.runtime.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tool } from '@google/genai';
import { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
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
import { createConfigParams } from './chatSession-runtime-helpers.js';

describe('ChatSession runtime streaming and abort behavior', () => {
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
      metadata: { source: 'chatSession.runtime.streaming.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
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
      metadata: { source: 'chatSession.runtime.streaming.test' },
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
});
