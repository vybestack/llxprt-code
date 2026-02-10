/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChat } from '../geminiChat.js';
import { HistoryService } from '../../services/history/HistoryService.js';
import type { IContent } from '../../services/history/IContent.js';
import { createAgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../../runtime/createAgentRuntimeContext.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { ContentGenerator } from '../contentGenerator.js';

function createUserMessage(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text' as const, text }],
  };
}

function createAiTextMessage(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text' as const, text }],
  };
}

function createToolCallAiMessage(callIds: string[]): IContent {
  return {
    speaker: 'ai',
    blocks: callIds.map((id) => ({
      type: 'tool_call' as const,
      id,
      name: 'some_tool',
      parameters: {},
    })),
  };
}

function createToolResponseMessage(callId: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response' as const,
        callId,
        toolName: 'some_tool',
        result: 'Tool output',
      },
    ],
  };
}

describe('Sandwich Compression (Issue #1011)', () => {
  let historyService: HistoryService;
  let runtimeContext: AgentRuntimeContext;
  let mockContentGenerator: ContentGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();

    const runtimeState = createAgentRuntimeState({
      runtimeId: 'test-runtime',
      provider: 'test-provider',
      model: 'test-model',
      sessionId: 'test-session',
    });

    const mockProviderAdapter = {
      getActiveProvider: vi.fn(() => ({
        name: 'test-provider',
        generateChatCompletion: vi.fn(),
      })),
    };

    const mockTelemetryAdapter = {
      recordTokenUsage: vi.fn(),
      recordEvent: vi.fn(),
    };

    const mockToolsView = {
      getToolRegistry: vi.fn(() => undefined),
    };

    runtimeContext = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 131134,
        preserveThreshold: 0.3,
        telemetry: { enabled: false, target: null },
      },
      provider: mockProviderAdapter,
      telemetry: mockTelemetryAdapter,
      tools: mockToolsView,
      providerRuntime: {
        runtimeId: 'test-runtime',
        settingsService: {} as never,
        config: {} as never,
      },
    });

    mockContentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      embedContent: vi.fn(),
    } as unknown as ContentGenerator;
  });

  describe('topPreserveThreshold ephemeral setting', () => {
    it('should return correct default value of 0.2 when not specified in settings', () => {
      const defaultThreshold = runtimeContext.ephemerals.topPreserveThreshold();
      expect(defaultThreshold).toBe(0.2);
    });

    it('should return override value when specified in settings', () => {
      const runtimeState = createAgentRuntimeState({
        runtimeId: 'test-runtime-2',
        provider: 'test-provider',
        model: 'test-model',
        sessionId: 'test-session',
      });

      const mockProviderAdapter = {
        getActiveProvider: vi.fn(() => ({
          name: 'test-provider',
          generateChatCompletion: vi.fn(),
        })),
      };

      const mockTelemetryAdapter = {
        recordTokenUsage: vi.fn(),
        recordEvent: vi.fn(),
      };

      const mockToolsView = {
        getToolRegistry: vi.fn(() => undefined),
      };

      const customContext = createAgentRuntimeContext({
        state: runtimeState,
        history: new HistoryService(),
        settings: {
          compressionThreshold: 0.8,
          contextLimit: 131134,
          preserveThreshold: 0.3,
          topPreserveThreshold: 0.25,
          telemetry: { enabled: false, target: null },
        },
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: {
          runtimeId: 'test-runtime',
          settingsService: {} as never,
          config: {} as never,
        },
      });

      const customThreshold = customContext.ephemerals.topPreserveThreshold
        ? customContext.ephemerals.topPreserveThreshold()
        : undefined;
      expect(customThreshold).toBe(0.25);
    });
  });

  describe('getCompressionSplit with sandwich approach', () => {
    it('should return correct top/bottom split for 20 messages with 0.2/0.3 thresholds', () => {
      // Add 20 messages to history (10 user + 10 AI)
      for (let i = 0; i < 10; i++) {
        historyService.add(createUserMessage(`User message ${i}`));
        historyService.add(createAiTextMessage(`AI response ${i}`));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      // @ts-expect-error - testing private method
      const result = chat['getCompressionSplit']();

      // Should preserve top 20% (first 4 messages out of 20)
      // Should preserve bottom 30% (last 6 messages out of 20)
      // Should compress middle 50% (10 messages)
      // Note: Actual values may differ slightly due to tool call boundary adjustments
      expect(result.toKeepTop).toBeDefined();
      expect(result.toCompress).toBeDefined();
      expect(result.toKeepBottom).toBeDefined();
      expect(result.toKeepTop.length).toBe(4);
      expect(result.toCompress.length).toBe(10);
      expect(result.toKeepBottom.length).toBe(6);
    });

    it('should handle overlap gracefully by failing to middle section', () => {
      // Add only 4 messages (10 total: 5 user + 5 AI)
      // With small dataset, top 20% + bottom 30% may overlap
      for (let i = 0; i < 4; i++) {
        historyService.add(createUserMessage(`User message ${i}`));
        historyService.add(createAiTextMessage(`AI response ${i}`));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      // @ts-expect-error - testing private method
      const result = chat['getCompressionSplit']();

      // With only 8 messages and minimum 4 required for compression,
      // the split should preserve everything (no compression)
      expect(result.toCompress.length).toBe(0);
      expect(result.toKeepTop.length + result.toKeepBottom.length).toBe(
        historyService.getCurated().length,
      );
    });

    it('should preserve tool call boundaries for both splits', () => {
      historyService.add(createUserMessage('Start'));

      for (let i = 0; i < 10; i++) {
        const toolCallId = `tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      historyService.add(createUserMessage('End'));

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      // @ts-expect-error - testing private method
      const result = chat['getCompressionSplit']();

      // Check that tool calls are not split
      const toolCallCount = (msg: IContent) =>
        msg.blocks.filter((b) => b.type === 'tool_call').length;
      const toolResponseCount = (msg: IContent) =>
        msg.blocks.filter((b) => b.type === 'tool_response').length;

      // Count compressed tool calls and responses
      const compressedToolCalls = result.toCompress.reduce(
        (sum, msg) => sum + toolCallCount(msg),
        0,
      );
      const compressedToolResponses = result.toCompress.reduce(
        (sum, msg) => sum + toolResponseCount(msg),
        0,
      );

      // The number of tool calls should equal the number of tool responses in compressed section
      expect(compressedToolCalls).toBe(compressedToolResponses);
    });
  });

  describe('performCompression integration', () => {
    it('should integrate all three sections correctly', async () => {
      // Add enough messages to trigger compression
      for (let i = 0; i < 20; i++) {
        historyService.add(createUserMessage(`User message ${i}`));
        historyService.add(createAiTextMessage(`AI response ${i}`));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const mockProvider = {
        name: 'test-provider',
        generateChatCompletion: vi.fn(async function* () {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: '<state_snapshot><overall_goal>Test goal</overall_goal></state_snapshot>',
              },
            ],
          };
        }),
      };

      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // Should have summary + kept top + kept bottom
      // Compressed middle should be replaced by summary
      expect(finalHistory.length).toBeGreaterThan(0);
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);
    });
  });

  describe('applyCompression order', () => {
    it('should maintain proper order: top + summary + bottom', () => {
      // Add test messages
      for (let i = 0; i < 10; i++) {
        historyService.add(createUserMessage(`User ${i}`));
        historyService.add(createAiTextMessage(`AI ${i}`));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      // @ts-expect-error - testing private method
      const split = chat['getCompressionSplit']();

      const summary =
        '<state_snapshot><overall_goal>Summary</overall_goal></state_snapshot>';

      // @ts-expect-error - testing private method
      chat['applyCompression'](summary, split.toKeepTop, split.toKeepBottom);

      const finalHistory = historyService.getCurated();

      // First messages should be from toKeepTop
      const firstMessage = finalHistory[0];
      const firstInTop = split.toKeepTop[0];
      expect(firstMessage?.id).toBe(firstInTop?.id);

      // Last messages should be from toKeepBottom
      const lastMessage = finalHistory[finalHistory.length - 1];
      const lastInBottom = split.toKeepBottom[split.toKeepBottom.length - 1];
      expect(lastMessage?.id).toBe(lastInBottom?.id);

      // There should be a summary in between
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);
    });
  });
});
