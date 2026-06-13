/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
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
import { AfterModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

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

/**
 * Issue #1749: AfterModel hook modified-response text must not be overwritten
 * (or left stale) by the pre-hook aggregatedText in
 * DirectMessageProcessor._processDirectResponse().
 *
 * When the AfterModel hook returns a modified response via getModifiedResponse(),
 * the resulting response.text must reflect the hook's intended text, not the
 * original provider text aggregated before the hook fired.
 */
describe('Issue 1749: AfterModel hook modified-response text', () => {
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
      metadata: { source: 'chatSession.issue1749.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  function buildChatSession(hookConfig: Config): ChatSession {
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: 'stub',
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

    return new ChatSession(view, {} as unknown as ContentGenerator, {}, []);
  }

  function registerStubProvider(text: string): void {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text }],
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
    } as unknown as IProvider;
    manager.registerProvider(provider);
  }

  it('reflects hook-modified text in response.text instead of stale provider text', async () => {
    registerStubProvider('original provider text');

    const hookConfig = Object.create(config) as Config;
    Object.defineProperties(hookConfig, {
      getEnableHooks: { value: () => true },
      getHookSystem: {
        value: () => ({
          initialize: async () => undefined,
          fireBeforeToolSelectionEvent: async () => undefined,
          fireBeforeModelEvent: async () => undefined,
          fireAfterModelEvent: async () =>
            new AfterModelHookOutput({
              hookSpecificOutput: {
                llm_response: {
                  candidates: [
                    {
                      content: {
                        role: 'model' as const,
                        parts: ['hook modified text'],
                      },
                      finishReason: 'STOP' as const,
                    },
                  ],
                },
              },
            }),
        }),
      },
    });

    const chat = buildChatSession(hookConfig);

    const response = await chat.generateDirectMessage(
      { message: 'Trigger AfterModel modification' },
      'prompt-issue-1749',
    );

    expect(response.text).toBe('hook modified text');
    expect(response.text).not.toContain('original provider text');
    expect(JSON.stringify(response)).not.toContain('original provider text');
  });

  it('preserves provider text when AfterModel hook does not modify the response', async () => {
    registerStubProvider('plain provider text');

    const hookConfig = Object.create(config) as Config;
    Object.defineProperties(hookConfig, {
      getEnableHooks: { value: () => true },
      getHookSystem: {
        value: () => ({
          initialize: async () => undefined,
          fireBeforeToolSelectionEvent: async () => undefined,
          fireBeforeModelEvent: async () => undefined,
          fireAfterModelEvent: async () => new AfterModelHookOutput({}),
        }),
      },
    });

    const chat = buildChatSession(hookConfig);

    const response = await chat.generateDirectMessage(
      { message: 'No modification' },
      'prompt-issue-1749-noop',
    );

    expect(response.text).toBe('plain provider text');
  });
});
