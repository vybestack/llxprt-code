/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #1150: Anthropic thinking blocks must be attached to tool call messages
 *
 * Behavioral tests for thinking/tool-call co-location in ChatSession history.
 * REPRO/root-cause scenarios live in chatSession.thinking-toolcalls.repro.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createConfigParams } from './chatSession-thinking-helpers.js';

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

describe('Issue #1150: Thinking blocks must be attached to tool call messages', () => {
  let settingsService: SettingsService;
  let config: Config;
  let manager: TestRuntimeProviderManager;
  let providerRuntime: ProviderRuntimeContext;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = new Config(createConfigParams(settingsService));

    settingsService.set('providers.anthropic.auth-key', 'test-api-key');
    settingsService.set(
      'providers.anthropic.model',
      'claude-sonnet-4-5-20250929',
    );
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.includeInContext', true);
    settingsService.set('reasoning.stripFromContext', 'none');

    providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.runtime.issue1150',
      metadata: { source: 'chatSession.thinking-toolcalls.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  it('should combine thinking block with subsequent tool calls in same history entry when yielded separately', async () => {
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
            thought:
              'Let me analyze this request and determine which tools to use.',
            sourceField: 'thinking',
            signature: 'test-signature-abc123',
          } as ThinkingBlock,
        ],
      } as IContent;

      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: "I'll make some tool calls now.",
          },
        ],
      } as IContent;

      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_001',
            name: 'list_directory',
            parameters: { path: '/tmp' },
          },
        ],
      } as IContent;

      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_002',
            name: 'read_file',
            parameters: { absolute_path: '/tmp/test.txt' },
          },
        ],
      } as IContent;
    });

    const provider: IProvider = {
      name: 'anthropic',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'claude-sonnet-4-5-20250929',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'test-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-issue1150',
      provider: provider.name,
      model: 'claude-sonnet-4-5-20250929',
      sessionId: config.getSessionId(),
    });

    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 200000,
        preserveThreshold: 0.2,
        telemetry: { enabled: true, target: null },
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
      { message: 'Make some tool calls while thinking' },
      'prompt-issue1150',
    );

    for await (const _event of stream) {
      // exhaust stream to trigger history recording
    }

    const curated = historyService.getCuratedForProvider();

    // Find the AI message that has tool calls
    const aiMessageWithToolCalls = curated.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    expect(aiMessageWithToolCalls).toBeDefined();

    // THE KEY ASSERTION: The thinking block MUST be in the SAME message as the tool calls
    const hasThinkingBlock = aiMessageWithToolCalls?.blocks.some(
      (block) => block.type === 'thinking',
    );

    expect(hasThinkingBlock).toBe(true);

    // Verify thinking block comes BEFORE tool calls (order matters for Anthropic)
    const thinkingIndex = aiMessageWithToolCalls?.blocks.findIndex(
      (block) => block.type === 'thinking',
    );
    const firstToolCallIndex = aiMessageWithToolCalls?.blocks.findIndex(
      (block) => block.type === 'tool_call',
    );

    expect(thinkingIndex).toBeLessThan(firstToolCallIndex!);
  });

  it('should preserve thinking signature when combining with tool calls', async () => {
    const calls: GenerateChatOptions[] = [];
    const testSignature = 'anthropic-thinking-signature-xyz789';

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);

      // Thinking with signature (required by Anthropic for multi-turn)
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Processing the request...',
            sourceField: 'thinking',
            signature: testSignature,
          } as ThinkingBlock,
        ],
      } as IContent;

      // Tool call
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_sig_001',
            name: 'glob',
            parameters: { pattern: '**/*.ts' },
          },
        ],
      } as IContent;
    });

    const provider: IProvider = {
      name: 'anthropic',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'claude-sonnet-4-5-20250929',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'test-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-issue1150-sig',
      provider: provider.name,
      model: 'claude-sonnet-4-5-20250929',
      sessionId: config.getSessionId(),
    });

    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 200000,
        preserveThreshold: 0.2,
        telemetry: { enabled: true, target: null },
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
      { message: 'Find typescript files' },
      'prompt-sig-test',
    );

    for await (const _event of stream) {
      // exhaust stream
    }

    const curated = historyService.getCuratedForProvider();
    const aiMessage = curated.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    const thinkingBlock = aiMessage?.blocks.find(
      (block) => block.type === 'thinking',
    );

    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock?.signature).toBe(testSignature);
  });

  it('should handle multiple tool calls with thinking block in multi-turn conversation', async () => {
    let callCount = 0;
    const calls: GenerateChatOptions[] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);
      callCount++;

      if (callCount === 1) {
        // First turn: thinking + tool calls
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First turn thinking',
              sourceField: 'thinking',
              signature: 'sig-turn-1',
            } as ThinkingBlock,
          ],
        } as IContent;

        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_turn1_001',
              name: 'list_directory',
              parameters: { path: '/tmp' },
            },
          ],
        } as IContent;
      } else {
        // Second turn: just text response after tool results
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Here are the results.' }],
        } as IContent;
      }
    });

    const provider: IProvider = {
      name: 'anthropic',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'claude-sonnet-4-5-20250929',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'test-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-issue1150-multiturn',
      provider: provider.name,
      model: 'claude-sonnet-4-5-20250929',
      sessionId: config.getSessionId(),
    });

    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 200000,
        preserveThreshold: 0.2,
        telemetry: { enabled: true, target: null },
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

    // First turn: user message -> thinking + tool calls
    const stream1 = await chat.sendMessageStream(
      { message: 'List the directory' },
      'prompt-turn1',
    );
    for await (const _event of stream1) {
      // exhaust stream
    }

    // Simulate tool response being added to history
    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_turn1_001',
          toolName: 'list_directory',
          result: { output: 'file1.txt\nfile2.txt' },
        },
      ],
    });

    // Second turn: continuation after tool response
    const stream2 = await chat.sendMessageStream(
      { message: 'What did you find?' },
      'prompt-turn2',
    );
    for await (const _event of stream2) {
      // exhaust stream
    }

    // Check the second call's contents - it should have the AI message with thinking + tool_call
    expect(calls.length).toBe(2);
    const secondCallContents = calls[1].contents;

    // Find the AI message with tool calls in the history sent to provider
    const aiWithToolCall = secondCallContents.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    expect(aiWithToolCall).toBeDefined();

    // The thinking block MUST be present in this message for Anthropic
    const hasThinking = aiWithToolCall?.blocks.some(
      (block) => block.type === 'thinking',
    );
    expect(hasThinking).toBe(true);
  });

  it('should NOT create separate history entries for thinking and tool calls', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      // Separate yields (current problematic behavior)
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Thinking separately',
            sourceField: 'thinking',
            signature: 'sig-separate',
          } as ThinkingBlock,
        ],
      } as IContent;

      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_separate_001',
            name: 'search_file_content',
            parameters: { pattern: 'test' },
          },
        ],
      } as IContent;
    });

    const provider: IProvider = {
      name: 'anthropic',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'claude-sonnet-4-5-20250929',
      generateChatCompletion: generateChatCompletionMock,
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
      getAuthToken: vi.fn(async () => 'test-auth-token'),
    };

    manager.registerProvider(provider);

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-issue1150-separate',
      provider: provider.name,
      model: 'claude-sonnet-4-5-20250929',
      sessionId: config.getSessionId(),
    });

    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 200000,
        preserveThreshold: 0.2,
        telemetry: { enabled: true, target: null },
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
      { message: 'Search for something' },
      'prompt-separate-test',
    );

    for await (const _event of stream) {
      // exhaust stream
    }

    const curated = historyService.getCuratedForProvider();

    // Count AI messages - there should be only ONE that contains both thinking and tool_call
    const aiMessages = curated.filter((c) => c.speaker === 'ai');

    const messagesWithBoth = aiMessages.filter(
      (msg) =>
        msg.blocks.some((b) => b.type === 'thinking') &&
        msg.blocks.some((b) => b.type === 'tool_call'),
    );

    expect(messagesWithBoth.length).toBe(1);

    // There should NOT be a separate thinking-only AI message
    const thinkingOnlyMessages = aiMessages.filter(
      (msg) =>
        msg.blocks.some((b) => b.type === 'thinking') &&
        !msg.blocks.some((b) => b.type === 'tool_call'),
    );

    expect(thinkingOnlyMessages.length).toBe(0);
  });
});
