/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #1150: REPRO and root-cause scenarios for thinking/tool-call history.
 * Sibling to chatSession.thinking-toolcalls.test.ts (split to avoid file-level
 * max-lines/no-console disable).
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
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import {
  createConfigParams,
  isThoughtPart,
} from './chatSession-thinking-helpers.js';

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

describe('Issue #1150 REPRO: thinking/tool-call round-trip and history persistence', () => {
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
      runtimeId: 'test.runtime.issue1150.repro',
      metadata: { source: 'chatSession.thinking-toolcalls.repro.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  it('ISSUE #1150 REPRO: thinking blocks must have thought=true when converted to Gemini format', async () => {
    const historyService = new HistoryService();

    // Simulate what recordHistory does: add an AI message with thinking + tool calls
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'Let me think about this...',
          sourceField: 'thinking',
          signature: 'sig-test-123',
        } as ThinkingBlock,
        {
          type: 'text',
          text: "I'll help you with that.",
        },
        {
          type: 'tool_call',
          id: 'hist_tool_repro_001',
          name: 'list_directory',
          parameters: { path: '/tmp' },
        },
      ],
    });

    // Add tool response
    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_repro_001',
          toolName: 'list_directory',
          result: { output: 'file1.txt' },
        },
      ],
    });

    // Get curated history (what would be sent to provider)
    const curated = historyService.getCuratedForProvider();

    // Convert to Gemini format (what AnthropicProvider receives as options.contents)
    const geminiContents = ContentConverters.toGeminiContents(curated);

    // Find the model message with tool calls
    const modelMessage = geminiContents.find(
      (c) =>
        c.role === 'model' &&
        (c.parts?.some((p) => 'functionCall' in p) ?? false),
    );

    expect(modelMessage).toBeDefined();

    // THE KEY CHECK: The thinking block must have thought=true
    const thinkingPart = modelMessage?.parts?.find(
      (p) => 'thought' in p && p.thought === true,
    );

    expect(thinkingPart).toBeDefined();
    expect(
      (thinkingPart as { thoughtSignature?: string }).thoughtSignature,
    ).toBe('sig-test-123');

    // Also verify order: thinking must come BEFORE tool calls
    const thinkingIndex = modelMessage?.parts?.findIndex(
      (p) => 'thought' in p && p.thought === true,
    );
    const toolCallIndex = modelMessage?.parts?.findIndex(
      (p) => 'functionCall' in p,
    );

    expect(thinkingIndex).toBeLessThan(toolCallIndex!);
  });

  it('ISSUE #1150 REPRO: second API call must include thinking block from first turn', async () => {
    let callCount = 0;
    const capturedContents: IContent[][] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      callCount++;
      capturedContents.push([...options.contents]);

      if (callCount === 1) {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First turn thinking - must appear in second call',
              sourceField: 'thinking',
              signature: 'sig-first-turn-abc',
            } as ThinkingBlock,
          ],
        } as IContent;

        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_turn1',
              name: 'read_file',
              parameters: { absolute_path: '/test.txt' },
            },
          ],
        } as IContent;
      } else {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Done!' }],
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
      runtimeId: 'runtime-issue1150-multiturn-repro',
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

    // First turn
    const stream1 = await chat.sendMessageStream(
      { message: 'Read a file' },
      'prompt-turn1',
    );
    for await (const _event of stream1) {
      // exhaust
    }

    // Add tool response to history (simulating what coreToolScheduler does)
    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_turn1',
          toolName: 'read_file',
          result: { output: 'file contents' },
        },
      ],
    });

    // Second turn - this is where the bug manifests
    const stream2 = await chat.sendMessageStream(
      { message: 'What did you find?' },
      'prompt-turn2',
    );
    for await (const _event of stream2) {
      // exhaust
    }

    expect(callCount).toBe(2);

    // THE CRITICAL CHECK: The second API call must include the thinking block
    const secondCallContents = capturedContents[1];

    const aiWithToolCall = secondCallContents.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    expect(aiWithToolCall).toBeDefined();

    const hasThinkingBlock = aiWithToolCall?.blocks.some(
      (block) => block.type === 'thinking',
    );

    // This assertion will FAIL with the current code, exposing the bug
    expect(hasThinkingBlock).toBe(true);

    const thinkingBlock = aiWithToolCall?.blocks.find(
      (block) => block.type === 'thinking',
    );

    expect(thinkingBlock?.signature).toBe('sig-first-turn-abc');
  });

  it('ISSUE #1150 REAL BUG: thinking block NOT in error dump - the Turn.run contextForReport shows Gemini format not IContent', async () => {
    // Verify recordHistory extracts thinking correctly from Parts with thought=true
    // by exercising the shared isThoughtPart predicate against consolidated model
    // output that mixes thinking, text, and tool-call parts.

    const consolidatedParts = [
      {
        thought: true,
        text: 'Let me analyze this request...',
        thoughtSignature: 'sig-anthropic-abc',
        llxprtSourceField: 'thinking',
      },
      {
        text: "I'll help you with that.",
      },
      {
        functionCall: {
          id: 'hist_tool_verify_001',
          name: 'list_directory',
          args: { path: '/tmp' },
        },
      },
    ];

    const thoughtParts = consolidatedParts.filter(isThoughtPart);

    expect(thoughtParts.length).toBe(1);
    expect(thoughtParts[0].text).toBe('Let me analyze this request...');
    expect(thoughtParts[0].thoughtSignature).toBe('sig-anthropic-abc');
    expect(thoughtParts[0].llxprtSourceField).toBe('thinking');

    // Now verify it creates ThinkingBlocks correctly
    const thoughtBlocks = thoughtParts.map(
      (part): ThinkingBlock => ({
        type: 'thinking',
        thought: (part.text ?? '').trim(),
        sourceField: (part.llxprtSourceField ??
          'thought') as ThinkingBlock['sourceField'],
        signature: part.thoughtSignature,
      }),
    );

    expect(thoughtBlocks.length).toBe(1);
    expect(thoughtBlocks[0].thought).toBe('Let me analyze this request...');
    expect(thoughtBlocks[0].signature).toBe('sig-anthropic-abc');
    expect(thoughtBlocks[0].sourceField).toBe('thinking');

    // So recordHistory SHOULD work correctly IF it receives consolidatedParts
    // with thought=true parts. The bug must be that the thinking part
    // is NOT making it into consolidatedParts in the first place!
  });

  it('ISSUE #1150 THE ACTUAL BUG: processStreamResponse loses thinking when text check fails', async () => {
    const generateChatCompletionMock = vi.fn(async function* () {
      // Yield thinking block (like Anthropic does)
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'This thinking should be in history',
            sourceField: 'thinking',
            signature: 'sig-must-survive',
          } as ThinkingBlock,
        ],
      } as IContent;

      // Yield text (like Anthropic does)
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Response text' }],
      } as IContent;

      // Yield tool call (like Anthropic does)
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_actual_bug_001',
            name: 'test_tool',
            parameters: {},
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
      runtimeId: 'runtime-actual-bug',
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
      { message: 'Test message' },
      'prompt-actual-bug',
    );

    for await (const _event of stream) {
      // exhaust stream - this triggers recordHistory at the end
    }

    // NOW CHECK: What's in the history?
    const allHistory = historyService.getAll();

    // Find AI messages
    const aiMessages = allHistory.filter((c) => c.speaker === 'ai');

    // Find message with tool calls
    const aiWithToolCall = aiMessages.find((c) =>
      c.blocks.some((b) => b.type === 'tool_call'),
    );

    expect(aiWithToolCall).toBeDefined();

    // THE BUG: Does it have a thinking block?
    const hasThinking = aiWithToolCall?.blocks.some(
      (b) => b.type === 'thinking',
    );

    // THIS WILL FAIL - exposing the bug!
    expect(hasThinking).toBe(true);

    // Also check for signature
    const thinkingBlock = aiWithToolCall?.blocks.find(
      (b) => b.type === 'thinking',
    );

    expect(thinkingBlock?.signature).toBe('sig-must-survive');
  });

  it('ISSUE #1150 ROOT CAUSE: thinking blocks are lost during Gemini format round-trip', async () => {
    const historyService = new HistoryService();

    // Simulate the Part[] that processStreamResponse would accumulate:
    const simulatedParts = [
      {
        thought: true,
        text: 'Let me think about this...',
        thoughtSignature: 'sig-abc-123',
        llxprtSourceField: 'thinking',
      },
      {
        text: "I'll help you.",
      },
      {
        functionCall: {
          id: 'hist_tool_test_001',
          name: 'list_directory',
          args: { path: '/tmp' },
        },
      },
    ];

    const thoughtParts = simulatedParts.filter(isThoughtPart);

    // recordHistory creates ThinkingBlocks from thought parts:
    const thoughtBlocks = thoughtParts.map((part) => ({
      type: 'thinking' as const,
      thought: ((part as { text?: string }).text ?? '').trim(),
      sourceField:
        (part as { llxprtSourceField?: string }).llxprtSourceField ?? 'thought',
      signature: (part as { thoughtSignature?: string }).thoughtSignature,
    }));

    const iContent: IContent = {
      speaker: 'ai',
      blocks: [
        ...thoughtBlocks,
        { type: 'text', text: "I'll help you." },
        {
          type: 'tool_call',
          id: 'hist_tool_test_001',
          name: 'list_directory',
          parameters: { path: '/tmp' },
        },
      ],
    };

    historyService.add(iContent);

    // Add tool response
    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_test_001',
          toolName: 'list_directory',
          result: { output: 'file1.txt' },
        },
      ],
    });

    // Now get curated for provider (what would be sent on next turn)
    const curated = historyService.getCuratedForProvider();

    // Find the AI message with tool calls
    const aiMessage = curated.find(
      (c) => c.speaker === 'ai' && c.blocks.some((b) => b.type === 'tool_call'),
    );

    expect(aiMessage).toBeDefined();

    // THE KEY CHECK: thinking block must be present with sourceField and signature
    const thinkingBlock = aiMessage?.blocks.find((b) => b.type === 'thinking');

    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock?.sourceField).toBe('thinking');
    expect(thinkingBlock?.signature).toBe('sig-abc-123');

    // Now convert to Gemini format and back to IContent
    const geminiContents = ContentConverters.toGeminiContents(curated);

    const modelMessage = geminiContents.find(
      (c) =>
        c.role === 'model' &&
        (c.parts?.some((p) => 'functionCall' in p) ?? false),
    );

    expect(modelMessage).toBeDefined();

    const thoughtPart = modelMessage?.parts?.find(
      (p) => 'thought' in p && (p as { thought: unknown }).thought === true,
    );

    expect(thoughtPart).toBeDefined();
    expect(
      (thoughtPart as { thoughtSignature?: string }).thoughtSignature,
    ).toBe('sig-abc-123');

    // Now convert back to IContent (what happens when we call toIContents)
    const roundTrippedContents = ContentConverters.toIContents(geminiContents);

    const roundTrippedAi = roundTrippedContents.find(
      (c) => c.speaker === 'ai' && c.blocks.some((b) => b.type === 'tool_call'),
    );

    expect(roundTrippedAi).toBeDefined();

    // THE CRITICAL CHECK: After round-trip, thinking block must still have signature
    const roundTrippedThinking = roundTrippedAi?.blocks.find(
      (b) => b.type === 'thinking',
    );

    // THIS WILL FAIL if the round-trip loses the signature
    expect(roundTrippedThinking).toBeDefined();
    expect(roundTrippedThinking?.signature).toBe('sig-abc-123');
    expect(roundTrippedThinking?.sourceField).toBe('thinking');
  });
});
