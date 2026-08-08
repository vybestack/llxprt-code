/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for per-turn system-prompt assembly at the ChatSession
 * seam (issue #3136, Step 1).
 *
 * Headline regression: after a mid-session `/model` change, the system
 * instruction handed to the provider on the NEXT turn names the NEW model
 * — the same model the provider resolves as body.model — on ALL THREE send
 * paths (sendMessage, sendMessageStream, generateDirectMessage). Also
 * verifies base token-offset recomputation, and that sessions constructed
 * without an assembler keep their seeded instruction untouched.
 *
 * Subagent persona and interactionMode are covered in
 * subagentRuntimeSetup.assembler.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import type {
  ChatSessionConfig,
  SystemPromptAssembler,
} from './chatSession.js';
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

/**
 * Test fixture: a ChatSession wired to a stub provider whose
 * `getCurrentModel()` reads the ephemeral `model` setting from the
 * SettingsService — exactly like BaseProvider.computeModel does. Changing
 * `settingsService.set('model', ...)` simulates a `/model` change.
 */
interface AssemblyFixture {
  chat: ChatSession;
  historyService: HistoryService;
  settingsService: SettingsService;
  capturedCalls: GenerateChatOptions[];
}

function buildFixture(
  assembler: SystemPromptAssembler,
  initialModel: string,
): AssemblyFixture {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));
  // The system prompt resolves its model through config.getModel()
  // (issue #3138), so drive that -- it is what a real `/model` change moves.
  Object.defineProperty(config, 'getModel', {
    value: () => settingsService.get('model') as string,
    configurable: true,
  });

  settingsService.set('providers.stub.base-url', 'https://stub.example.com');
  settingsService.set('providers.stub.auth-key', 'stub-api-key');
  settingsService.set('model', initialModel);

  const providerRuntime: ProviderRuntimeContext = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'test.runtime.assembly',
    metadata: { source: 'systemPromptAssembly.test' },
  });

  const capturedCalls: GenerateChatOptions[] = [];

  const provider: IProvider = {
    name: 'stub',
    isDefault: true,
    getModels: vi.fn(async () => []),
    getDefaultModel: () => initialModel,
    getCurrentModel: () =>
      (settingsService.get('model') as string | undefined) ?? initialModel,
    generateChatCompletion: vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      capturedCalls.push(options);
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'ok' }],
      };
    }),
    getServerTools: () => [],
    invokeServerTool: vi.fn(),
    getAuthToken: vi.fn(async () => 'stub-auth-token'),
  };

  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  config.setProviderManager(manager);
  manager.registerProvider(provider);

  // Minimal hook stubs so sendMessage does not crash on hook lookups.
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
    runtimeId: 'assembly-test',
    provider: 'stub',
    model: initialModel,
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
      telemetry: { enabled: false, target: null },
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(config.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime,
  });

  const generationConfig: ChatSessionConfig = {
    systemInstruction: 'STALE_PROMPT',
  };

  const chat = new ChatSession(
    view,
    {} as unknown as ContentGenerator,
    generationConfig,
    [],
    undefined,
    assembler,
  );

  return { chat, historyService, settingsService, capturedCalls };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('ChatSession per-turn system prompt assembly (issue #3136)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- sendMessage ---

  it('sendMessage: renders the fresh provider model after a mid-session /model change', async () => {
    const assembler: SystemPromptAssembler = {
      assemble: async (model) => `[model=${model}]`,
    };
    const fx = buildFixture(assembler, 'old-model');

    // First turn — stale name would appear without per-turn assembly
    await fx.chat.sendMessage({ message: 'first' }, 'p1');
    expect(fx.capturedCalls[0].systemInstruction).toBe('[model=old-model]');

    // Simulate /model change
    fx.settingsService.set('model', 'brand-new-model');

    // Second turn — must name the NEW model
    await fx.chat.sendMessage({ message: 'second' }, 'p2');
    expect(fx.capturedCalls[1].systemInstruction).toBe(
      '[model=brand-new-model]',
    );

    // The rendered model must equal what the provider resolves as body.model
    const providerModel = fx.settingsService.get('model');
    expect(fx.capturedCalls[1].systemInstruction).toContain(
      `[model=${providerModel}]`,
    );
  });

  it('sendMessage: recomputes base token offset when the assembled prompt changes', async () => {
    const assembler: SystemPromptAssembler = {
      assemble: async (model) => `Prompt for model ${model}.`,
    };
    const fx = buildFixture(assembler, 'short');

    await fx.chat.sendMessage({ message: 'turn-1' }, 'p1');
    const offsetAfterFirst = fx.historyService.getBaseTokenOffset();
    expect(offsetAfterFirst).toBeGreaterThan(0);

    // Change to a model name with a very different length
    fx.settingsService.set(
      'model',
      'a-much-longer-model-name-that-changes-token-count-significantly',
    );

    await fx.chat.sendMessage({ message: 'turn-2' }, 'p2');
    const offsetAfterSecond = fx.historyService.getBaseTokenOffset();
    expect(offsetAfterSecond).not.toBe(offsetAfterFirst);
    expect(offsetAfterSecond).toBeGreaterThan(0);
  });

  // --- sendMessageStream ---

  it('sendMessageStream: renders the fresh provider model after a mid-session /model change', async () => {
    const assembler: SystemPromptAssembler = {
      assemble: async (model) => `[stream model=${model}]`,
    };
    const fx = buildFixture(assembler, 'old-stream-model');

    const stream1 = await fx.chat.sendMessageStream(
      { message: 'first-stream' },
      'ps1',
    );
    for await (const _ of stream1) {
      // exhaust
    }
    expect(fx.capturedCalls[0].systemInstruction).toBe(
      '[stream model=old-stream-model]',
    );

    fx.settingsService.set('model', 'new-stream-model');

    const stream2 = await fx.chat.sendMessageStream(
      { message: 'second-stream' },
      'ps2',
    );
    for await (const _ of stream2) {
      // exhaust
    }
    expect(fx.capturedCalls[1].systemInstruction).toBe(
      '[stream model=new-stream-model]',
    );
  });

  // --- generateDirectMessage ---

  it('generateDirectMessage: renders the fresh provider model after a mid-session /model change', async () => {
    const assembler: SystemPromptAssembler = {
      assemble: async (model) => `[direct model=${model}]`,
    };
    const fx = buildFixture(assembler, 'old-direct-model');

    await fx.chat.generateDirectMessage({ message: 'first-direct' }, 'pd1');
    expect(fx.capturedCalls[0].systemInstruction).toBe(
      '[direct model=old-direct-model]',
    );

    fx.settingsService.set('model', 'new-direct-model');

    await fx.chat.generateDirectMessage({ message: 'second-direct' }, 'pd2');
    expect(fx.capturedCalls[1].systemInstruction).toBe(
      '[direct model=new-direct-model]',
    );
  });

  // --- No assembler → unchanged behavior ---

  it('leaves generationConfig.systemInstruction untouched when no assembler is injected', async () => {
    // buildFixture always injects an assembler; construct ChatSession manually
    // without one to verify backward-compatible behavior.
    const settingsService = new SettingsService();
    const config = new Config(createConfigParams(settingsService));
    Object.defineProperty(config, 'getModel', {
      value: () => settingsService.get('model') as string,
      configurable: true,
    });
    settingsService.set('providers.stub.base-url', 'https://stub.example.com');
    settingsService.set('providers.stub.auth-key', 'stub-api-key');
    settingsService.set('model', 'whatever');

    const providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.runtime.no-assembler',
      metadata: { source: 'test' },
    });
    const capturedCalls: GenerateChatOptions[] = [];
    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'whatever',
      getCurrentModel: () => 'whatever',
      generateChatCompletion: vi.fn(async function* (
        opts: GenerateChatOptions,
      ) {
        capturedCalls.push(opts);
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
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
      runtimeId: 'no-assembler-test',
      provider: 'stub',
      model: 'whatever',
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: new HistoryService(),
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

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      { systemInstruction: 'FROZEN_PROMPT' },
      [],
    );

    await chat.sendMessage({ message: 'hi' }, 'p1');
    expect(capturedCalls[0].systemInstruction).toBe('FROZEN_PROMPT');
  });
});
