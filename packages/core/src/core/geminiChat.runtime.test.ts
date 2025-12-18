/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GenerateContentConfig, Tool } from '@google/genai';
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
import { AuthType } from './contentGenerator.js';
import { createAgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../runtime/runtimeAdapters.js';

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
    fullContext: false,
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

    settingsService.set('providers.stub.baseURL', 'https://stub.example.com');
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
      authType: AuthType.USE_NONE,
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
      model: 'claude-test',
      authType: AuthType.USE_NONE,
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
});
