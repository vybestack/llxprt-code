/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #2329 on the direct (non-streaming consumer)
 * path: generateDirectMessage must preserve BOTH the visible refusal text and
 * the raw provider stop reason when a streaming provider emits the realistic
 * Anthropic shape — a text chunk first, then a trailing metadata-only chunk
 * carrying stopReason 'refusal'.
 *
 * Drives the public ChatSession.generateDirectMessage API with a stub
 * provider — no mock theater.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatSession } from './chatSession.js';
import type { TextBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
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
import { createConfigParams } from './chatSession-runtime-helpers.js';

/**
 * Extracts visible text from a neutral ModelOutput — the post-P13
 * replacement for the deleted GenerateContentResponse `.text` getter.
 */
function extractText(output: {
  content: { blocks: Array<{ type: string; text?: string }> };
}): string {
  return output.content.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

describe('Issue 2329: direct-path refusal preservation @issue:2329', () => {
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
      metadata: { source: 'chatSession.directRefusal.issue2329.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  function buildChatSession(provider: IProvider): ChatSession {
    manager.registerProvider(provider);
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
      providerRuntime: { ...providerRuntime },
    });
    return new ChatSession(view, {} as unknown as ContentGenerator, {}, []);
  }

  it('preserves refusal text AND raw stop reason when the refusal arrives on a trailing metadata-only chunk', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'I cannot help with that request.' }],
      };
      yield {
        speaker: 'ai',
        blocks: [],
        metadata: { stopReason: 'refusal' },
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

    const chat = buildChatSession(provider);
    const response = await chat.generateDirectMessage(
      { message: 'risky request' },
      'prompt-direct-refusal',
    );

    expect(extractText(response)).toBe('I cannot help with that request.');
    // refusal is a distinct canonical finish reason; rawStopReason preserves
    // the provider-native 'refusal' value on the neutral rawStopReason carrier.
    expect(response.finishReason).toBe('refusal');
    expect(response.rawStopReason).toBe('refusal');
  });

  it('preserves text and stop reason when a single chunk carries both', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Declined.' }],
        metadata: { stopReason: 'refusal' },
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

    const chat = buildChatSession(provider);
    const response = await chat.generateDirectMessage(
      { message: 'risky request' },
      'prompt-direct-refusal-single',
    );

    expect(extractText(response)).toBe('Declined.');
    expect(response.finishReason).toBe('refusal');
    expect(response.rawStopReason).toBe('refusal');
  });
});
