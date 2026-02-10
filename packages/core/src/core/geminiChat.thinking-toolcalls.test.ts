/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #1150: Anthropic thinking blocks must be attached to tool call messages
 *
 * When extended thinking is enabled, Anthropic requires that ALL assistant messages
 * start with thinking/redacted_thinking blocks. During streaming, the provider yields
 * thinking blocks and tool calls as separate IContent chunks. These must be combined
 * into a single history entry so that when the conversation continues, the assistant
 * message sent to Anthropic has the thinking block first, followed by tool_use blocks.
 *
 * Error when this fails:
 * "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `text`"
 *
 * THE FLOW:
 * 1. AnthropicProvider.generateChatCompletion yields separate IContent for each block type:
 *    - yield { speaker: 'ai', blocks: [ThinkingBlock] }
 *    - yield { speaker: 'ai', blocks: [TextBlock] }
 *    - yield { speaker: 'ai', blocks: [ToolCallBlock] }
 *
 * 2. GeminiChat.makeApiCallAndProcessStream converts each IContent to GenerateContentResponse:
 *    - convertIContentToResponse({ thinking }) -> { parts: [{ thought: true, text: '...' }] }
 *    - convertIContentToResponse({ text }) -> { parts: [{ text: '...' }] }
 *    - convertIContentToResponse({ tool_call }) -> { parts: [{ functionCall: {...} }] }
 *
 * 3. GeminiChat.processStreamResponse accumulates parts into modelResponseParts[]
 *
 * 4. GeminiChat.recordHistory receives modelOutput with all parts consolidated
 *
 * THE BUG: The thinking blocks with thought=true ARE being accumulated, BUT when
 * Anthropic's response has thinking FIRST, then text, then tool calls, the thinking
 * needs to stay attached to the tool calls in history. Currently this works via
 * recordHistory's thoughtBlocks logic, but we need to verify the full flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { createAgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../runtime/runtimeAdapters.js';
import type { IContent, ThinkingBlock } from '../services/history/IContent.js';
import { ContentConverters } from '../services/history/ContentConverters.js';

vi.mock('../utils/retry.js', () => ({
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
    model: 'claude-sonnet-4-5-20250929',
    settingsService,
  };
}

describe('Issue #1150: Thinking blocks must be attached to tool call messages', () => {
  let settingsService: SettingsService;
  let config: Config;
  let manager: ProviderManager;
  let providerRuntime: ProviderRuntimeContext;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = new Config(createConfigParams(settingsService));

    settingsService.set('providers.anthropic.apiKey', 'test-api-key');
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
      metadata: { source: 'geminiChat.thinking-toolcalls.test' },
    });

    manager = new ProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
  });

  it('should combine thinking block with subsequent tool calls in same history entry when yielded separately', async () => {
    const calls: GenerateChatOptions[] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      calls.push(options);

      // Simulate Anthropic streaming behavior: thinking block comes first as separate yield
      // This mimics what AnthropicProvider.generateChatCompletion does during streaming:
      // 1. First it yields the thinking block when content_block_stop for thinking is received
      // 2. Then it yields text (if any)
      // 3. Then it yields tool calls when content_block_stop for tool_use is received
      //
      // The IContent yields are separate, but they all need to end up in the SAME
      // history entry so Anthropic sees: [thinking, tool_use, tool_use, ...]
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

      // Text response comes separately
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: "I'll make some tool calls now.",
          },
        ],
      } as IContent;

      // Then tool calls come as a separate yield (this is what Anthropic does during streaming)
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

    const chat = new GeminiChat(
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
    // This is required by Anthropic's API - assistant messages must start with thinking
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

    const chat = new GeminiChat(
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
    ) as ThinkingBlock | undefined;

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

    const chat = new GeminiChat(
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
    const secondCallContents = calls[1].contents ?? [];

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

    const chat = new GeminiChat(
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

    // If thinking and tool calls are stored separately, this will fail
    // We expect exactly ONE AI message containing BOTH thinking AND tool_call blocks
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

  it('ISSUE #1150 REPRO: thinking blocks must have thought=true when converted to Gemini format', async () => {
    // This test reproduces the exact failure mode:
    // 1. AnthropicProvider yields IContent with ThinkingBlock
    // 2. convertIContentToResponse converts to Part with thought=true
    // 3. processStreamResponse accumulates parts
    // 4. recordHistory extracts thinking via isThoughtPart (checks thought===true)
    // 5. History entry is created with thinking blocks attached
    // 6. On next turn, getCuratedForProvider returns history
    // 7. toGeminiContent converts back, thinking blocks get thought=true
    // 8. But when sent to Anthropic, the thinking block must be FIRST
    //
    // The problem: When we convert IContent->Content->IContent, the thinking
    // must stay attached to tool calls AND have proper sourceField/signature

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
      (c) => c.role === 'model' && c.parts?.some((p) => 'functionCall' in p),
    );

    expect(modelMessage).toBeDefined();

    // THE KEY CHECK: The thinking block must have thought=true
    const thinkingPart = modelMessage?.parts?.find(
      (p) => 'thought' in p && p.thought === true,
    );

    expect(thinkingPart).toBeDefined();
    expect(
      (thinkingPart as { thoughtSignature?: string })?.thoughtSignature,
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
    // This is the REAL issue: After the first turn completes and tool results
    // are added, the SECOND API call must include the thinking block from the
    // first turn's AI response.
    //
    // Flow:
    // Turn 1: User -> AI (thinking + tool_call) -> Tool response
    // Turn 2: User -> AI (the request to API must have Turn 1's thinking block)

    let callCount = 0;
    const capturedContents: IContent[][] = [];

    const generateChatCompletionMock = vi.fn(async function* (
      options: GenerateChatOptions,
    ) {
      callCount++;
      capturedContents.push([...(options.contents ?? [])]);

      if (callCount === 1) {
        // First turn: yield thinking then tool call (separately, like Anthropic does)
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
        // Second turn: just text
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

    const chat = new GeminiChat(
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
    // from the first turn's AI response
    const secondCallContents = capturedContents[1];

    // Find the AI message with tool calls in the history sent to provider
    const aiWithToolCall = secondCallContents.find(
      (content) =>
        content.speaker === 'ai' &&
        content.blocks.some((block) => block.type === 'tool_call'),
    );

    expect(aiWithToolCall).toBeDefined();

    // THIS IS THE BUG: The thinking block is NOT present
    const hasThinkingBlock = aiWithToolCall?.blocks.some(
      (block) => block.type === 'thinking',
    );

    // This assertion will FAIL with the current code, exposing the bug
    expect(hasThinkingBlock).toBe(true);

    // Also verify the signature is preserved
    const thinkingBlock = aiWithToolCall?.blocks.find(
      (block) => block.type === 'thinking',
    ) as ThinkingBlock | undefined;

    expect(thinkingBlock?.signature).toBe('sig-first-turn-abc');
  });

  it('ISSUE #1150 REAL BUG: thinking block NOT in error dump - the Turn.run contextForReport shows Gemini format not IContent', async () => {
    // The error dump shows NO thought=true parts at all!
    // Message 1 has: text + functionCall (4x)
    // But the <think> block was displayed in the CLI output!
    //
    // CRITICAL INSIGHT: The error dump is created in Turn.run:
    //   const contextForReport = [...this.chat.getHistory(/*curated*/ true), req];
    //
    // getHistory(true) returns GEMINI Content[] format, NOT IContent[]!
    // So the dump shows what getHistory returns, which is toGeminiContents(getCurated())
    //
    // But the ACTUAL bug is that when recordHistory runs, it needs to:
    // 1. Extract thinking blocks from modelOutput (Content with thought=true Parts)
    // 2. Create IContent with ThinkingBlocks
    // 3. Store in history
    //
    // The issue: Let's verify recordHistory IS extracting thinking correctly
    // from Parts with thought=true

    // Simulate what processStreamResponse creates as consolidatedParts
    // when thinking comes as a separate chunk (with thought=true)
    // followed by text and tool calls
    const consolidatedParts = [
      // Thinking part (from separate yield, converted via convertIContentToResponse)
      {
        thought: true,
        text: 'Let me analyze this request...',
        thoughtSignature: 'sig-anthropic-abc',
        llxprtSourceField: 'thinking',
      },
      // Text part
      {
        text: "I'll help you with that.",
      },
      // Tool call part
      {
        functionCall: {
          id: 'hist_tool_verify_001',
          name: 'list_directory',
          args: { path: '/tmp' },
        },
      },
    ];

    // The isThoughtPart check from geminiChat.ts:
    const isThoughtPart = (
      part: unknown,
    ): part is {
      thought: true;
      text?: string;
      thoughtSignature?: string;
      llxprtSourceField?: string;
    } =>
      Boolean(
        part &&
          typeof part === 'object' &&
          'thought' in part &&
          (part as { thought: unknown }).thought === true,
      );

    // Extract thought parts like recordHistory does
    const thoughtParts = consolidatedParts.filter(isThoughtPart);

    // THIS SHOULD FIND THE THINKING PART
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
    // Let's trace exactly what happens in processStreamResponse:
    //
    // 1. For each chunk from streamResponse (converted IContent -> GenerateContentResponse):
    //    if (isValidResponse(chunk)) {
    //      const content = chunk.candidates?.[0]?.content;
    //      if (content?.parts) {
    //        ... check for functionCall, text ...
    //        if (includeThoughtsInHistory) {
    //          modelResponseParts.push(...content.parts);
    //        }
    //      }
    //    }
    //
    // 2. But WAIT - look at the text check:
    //    if (content.parts.some((part) => part.text && typeof part.text === 'string' && part.text.trim() !== ''))
    //      hasTextResponse = true;
    //
    //    For a thought part: { thought: true, text: 'thinking content' }
    //    This WILL match because part.text exists and is non-empty!
    //    So hasTextResponse will be true.
    //
    // 3. The parts should be pushed to modelResponseParts if includeThoughtsInHistory is true.
    //
    // 4. BUT: The error dump shows the history has NO thought parts.
    //    getHistory(true) calls toGeminiContents(getCurated())
    //    getCurated() returns IContent[]
    //    toGeminiContents converts IContent -> Content
    //
    // 5. So the question is: does getCurated() return IContent with ThinkingBlocks?
    //
    // Let's write a test that proves the EXACT failure point:
    // - Create a provider that yields thinking + tool call separately
    // - Call sendMessageStream
    // - Check what's in historyService AFTER the stream completes
    // - The thinking block should be there but IT'S NOT

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

    const chat = new GeminiChat(
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

    // DEBUG: Print what we got
    console.log('AI messages in history:', aiMessages.length);
    for (const msg of aiMessages) {
      console.log(
        '  Blocks:',
        msg.blocks.map((b) => b.type),
      );
    }

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
    ) as ThinkingBlock | undefined;

    expect(thinkingBlock?.signature).toBe('sig-must-survive');
  });

  it('ISSUE #1150 ROOT CAUSE: thinking blocks are lost during Gemini format round-trip', async () => {
    // This test exposes the EXACT bug: when processStreamResponse receives
    // separate chunks for thinking and tool calls, it accumulates them into
    // modelResponseParts. BUT the thinking block needs sourceField='thinking'
    // and signature to survive the round-trip through:
    //   IContent -> convertIContentToResponse -> Part with thought=true
    //   -> recordHistory -> IContent with ThinkingBlock
    //   -> getCuratedForProvider -> toGeminiContent -> Part with thought=true
    //   -> toIContent -> IContent with ThinkingBlock (must have sourceField + signature)
    //
    // The bug: When convertIContentToResponse creates a Part, it sets:
    //   { thought: true, text: '...', thoughtSignature: '...', llxprtSourceField: '...' }
    // But when processStreamResponse accumulates parts and recordHistory extracts
    // thoughtBlocks via isThoughtPart, it creates ThinkingBlocks from the Parts.
    // The signature and sourceField MUST be preserved.

    const historyService = new HistoryService();

    // Step 1: Manually add what processStreamResponse + recordHistory would create
    // when it receives separate IContent yields for thinking and tool calls.
    // The key is that recordHistory extracts thoughtBlocks from Parts with thought=true
    // and then attaches them to the first output content.

    // Simulate the Part[] that processStreamResponse would accumulate:
    // (This is what modelResponseParts would look like after processing 3 yields)
    const simulatedParts = [
      // From first yield: thinking block
      {
        thought: true,
        text: 'Let me think about this...',
        thoughtSignature: 'sig-abc-123',
        llxprtSourceField: 'thinking',
      },
      // From second yield: text block
      {
        text: "I'll help you.",
      },
      // From third yield: tool call
      {
        functionCall: {
          id: 'hist_tool_test_001',
          name: 'list_directory',
          args: { path: '/tmp' },
        },
      },
    ];

    // Now simulate what recordHistory does:
    // 1. Filter out thought parts from nonThoughtModelOutput
    // 2. Extract thoughtBlocks from parts with thought=true
    // 3. Attach thoughtBlocks to first output content

    // The isThoughtPart check:
    const isThoughtPart = (part: unknown): boolean =>
      Boolean(
        part &&
          typeof part === 'object' &&
          'thought' in part &&
          (part as { thought: unknown }).thought === true,
      );

    const thoughtParts = simulatedParts.filter(isThoughtPart);

    // recordHistory creates ThinkingBlocks from thought parts:
    const thoughtBlocks = thoughtParts.map((part) => ({
      type: 'thinking' as const,
      thought: ((part as { text?: string }).text ?? '').trim(),
      sourceField:
        (part as { llxprtSourceField?: string }).llxprtSourceField ?? 'thought',
      signature: (part as { thoughtSignature?: string }).thoughtSignature,
    }));

    // Then it creates the IContent with thoughtBlocks + other blocks
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
    const thinkingBlock = aiMessage?.blocks.find(
      (b) => b.type === 'thinking',
    ) as ThinkingBlock | undefined;

    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock?.sourceField).toBe('thinking');
    expect(thinkingBlock?.signature).toBe('sig-abc-123');

    // Now convert to Gemini format and back to IContent
    const geminiContents = ContentConverters.toGeminiContents(curated);

    // Find the model message
    const modelMessage = geminiContents.find(
      (c) => c.role === 'model' && c.parts?.some((p) => 'functionCall' in p),
    );

    expect(modelMessage).toBeDefined();

    // Check that thought=true part exists with signature
    const thoughtPart = modelMessage?.parts?.find(
      (p) => 'thought' in p && (p as { thought: unknown }).thought === true,
    );

    expect(thoughtPart).toBeDefined();
    expect(
      (thoughtPart as { thoughtSignature?: string })?.thoughtSignature,
    ).toBe('sig-abc-123');

    // Now convert back to IContent (what happens when we call toIContents)
    const roundTrippedContents = ContentConverters.toIContents(geminiContents);

    // Find the AI message with tool calls
    const roundTrippedAi = roundTrippedContents.find(
      (c) => c.speaker === 'ai' && c.blocks.some((b) => b.type === 'tool_call'),
    );

    expect(roundTrippedAi).toBeDefined();

    // THE CRITICAL CHECK: After round-trip, thinking block must still have signature
    const roundTrippedThinking = roundTrippedAi?.blocks.find(
      (b) => b.type === 'thinking',
    ) as ThinkingBlock | undefined;

    // THIS WILL FAIL if the round-trip loses the signature
    expect(roundTrippedThinking).toBeDefined();
    expect(roundTrippedThinking?.signature).toBe('sig-abc-123');
    expect(roundTrippedThinking?.sourceField).toBe('thinking');
  });
});
