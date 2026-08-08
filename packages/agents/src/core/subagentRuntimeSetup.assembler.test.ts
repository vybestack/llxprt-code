/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that the subagent per-turn assembler (injected into ChatSession by
 * createChatObject) preserves `interactionMode: 'subagent'` and the persona
 * across turns (issue #3136, Step 1).
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { createChatObject } from './subagentRuntimeSetup.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
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

// Capture getCoreSystemPromptAsync calls so we can assert interactionMode
// on both the creation-time call and the per-turn call.
const mockGetCorePrompt = vi.fn(async (args: Record<string, unknown>) => {
  const mode = args.interactionMode ?? 'unknown';
  return `[CORE_PROMPT mode=${mode}]`;
});

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: mockGetCorePrompt,
  getCompressionPrompt: vi.fn(() => 'COMPRESS'),
}));

describe('Subagent per-turn assembler (issue #3136)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let capturedCalls: GenerateChatOptions[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCorePrompt.mockClear();
    settingsService = new SettingsService();
    config = new Config(createConfigParams(settingsService));
    settingsService.set('providers.stub.base-url', 'https://stub.example.com');
    settingsService.set('providers.stub.auth-key', 'stub-api-key');
    settingsService.set('model', 'sub-model-v1');
    capturedCalls = [];
  });

  it('renders interactionMode=subagent and persona on the per-turn call after /model change', async () => {
    const providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.subagent.assembly',
      metadata: { source: 'subagent-assembler.test' },
    });

    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'sub-model-v1',
      getCurrentModel: () =>
        (settingsService.get('model') as string | undefined) ?? 'sub-model-v1',
      generateChatCompletion: vi.fn(async function* (
        opts: GenerateChatOptions,
      ) {
        capturedCalls.push(opts);
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] };
      }),
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'token'),
    };

    const manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
    manager.registerProvider(provider);

    Object.defineProperties(config, {
      getConversationLoggingEnabled: { value: () => false },
      getEnableHooks: { value: () => false },
      getHookSystem: {
        value: () => ({
          initialize: async () => undefined,
          isInitialized: () => true,
          fireBeforeModelEvent: async () => new BeforeModelHookOutput({}),
          fireAfterModelEvent: async () => new AfterModelHookOutput({}),
        }),
      },
    });

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'subagent-assembler-test',
      provider: 'stub',
      model: 'sub-model-v1',
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: new (
        await import(
          '@vybestack/llxprt-code-core/services/history/HistoryService.js'
        )
      ).HistoryService(),
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: { enabled: false, target: null },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime,
    });

    const PERSONA = 'You are a TypeScript expert subagent.';

    const chat = await createChatObject({
      promptConfig: { systemPrompt: PERSONA },
      modelConfig: { model: 'sub-model-v1', temp: 0, top_p: 1 },
      outputConfig: undefined,
      toolConfig: undefined,
      runtimeContext: view,
      contentGenerator: {} as unknown as ContentGenerator,
      environmentContextLoader: async () => [],
      foregroundConfig: config,
      context: { get: () => undefined, get_keys: () => [], set: () => {} },
    });

    expect(chat).not.toBeNull();

    // Creation-time call: interactionMode must be 'subagent'
    expect(mockGetCorePrompt).toHaveBeenCalledTimes(1);
    expect(mockGetCorePrompt.mock.calls[0][0]).toMatchObject({
      interactionMode: 'subagent',
      includeSubagentDelegation: false,
    });

    // --- Simulate /model change ---
    settingsService.set('model', 'sub-model-v2');

    // Start a turn — triggers the per-turn assembler
    await chat!.sendMessage({ message: 'do the task' }, 'p1');

    // The per-turn call must ALSO use interactionMode=subagent
    expect(mockGetCorePrompt).toHaveBeenCalledTimes(2);
    expect(mockGetCorePrompt.mock.calls[1][0]).toMatchObject({
      interactionMode: 'subagent',
      includeSubagentDelegation: false,
    });

    // The per-turn model must be the fresh one
    expect(mockGetCorePrompt.mock.calls[1][0]).toMatchObject({
      model: 'sub-model-v2',
    });

    // The system instruction must contain BOTH the core prompt and the persona
    const sysInstr = capturedCalls[0].systemInstruction as string;
    expect(sysInstr).toContain('[CORE_PROMPT mode=subagent]');
    expect(sysInstr).toContain(PERSONA);
  });
});
