/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GenerateContentConfig, Tool } from '@google/genai';
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

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

const retryWithBackoff = vi.mocked(
  await import('@vybestack/llxprt-code-core/utils/retry.js').then(
    (m) => m.retryWithBackoff,
  ),
);

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
});
