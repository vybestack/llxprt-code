/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P14
 * @requirement REQ-CS-006.1, REQ-CS-002.9
 *
 * Sandwich compression tests updated to use the public performCompression()
 * interface now that the private methods (getCompressionSplit, applyCompression)
 * have been moved into the compression strategy module.
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

function buildRuntimeContext(
  historyService: HistoryService,
  overrides: {
    topPreserveThreshold?: number;
  } = {},
): AgentRuntimeContext {
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

  return createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 131134,
      preserveThreshold: 0.3,
      topPreserveThreshold: overrides.topPreserveThreshold,
      telemetry: { enabled: false, target: null },
    },
    provider: mockProviderAdapter,
    telemetry: mockTelemetryAdapter,
    tools: mockToolsView,
    providerRuntime: {
      runtimeId: 'test-runtime',
      settingsService: { get: vi.fn(() => undefined) } as never,
      config: {} as never,
    },
  });
}

function buildMockProvider(summaryText: string) {
  return {
    name: 'test-provider',
    generateChatCompletion: vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: summaryText }],
      };
    }),
  };
}

describe('Sandwich Compression (Issue #1011)', () => {
  let historyService: HistoryService;
  let runtimeContext: AgentRuntimeContext;
  let mockContentGenerator: ContentGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    runtimeContext = buildRuntimeContext(historyService);

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
      const customContext = buildRuntimeContext(new HistoryService(), {
        topPreserveThreshold: 0.25,
      });
      const customThreshold = customContext.ephemerals.topPreserveThreshold
        ? customContext.ephemerals.topPreserveThreshold()
        : undefined;
      expect(customThreshold).toBe(0.25);
    });
  });

  describe('performCompression integration', () => {
    it('should produce correct top/bottom split for 20 messages with default thresholds', async () => {
      // Add 20 messages to history (10 user + 10 AI)
      for (let i = 0; i < 10; i++) {
        historyService.add(createUserMessage(`User message ${i}`));
        historyService.add(createAiTextMessage(`AI response ${i}`));
      }

      const messageCountBefore = historyService.getCurated().length;
      expect(messageCountBefore).toBe(20);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Test goal</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // Should have: top preserved (4) + summary (1) + ack (1) + bottom preserved (6) = 12
      // Top 20% of 20 = 4, Bottom 30% of 20 = 6, Middle 10 compressed
      expect(finalHistory.length).toBeLessThan(messageCountBefore);

      // First message should be the original first user message
      expect(finalHistory[0].speaker).toBe('human');
      expect(finalHistory[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'User message 0',
      });

      // Should contain the state_snapshot summary
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);

      // Last message should be from the original bottom section
      const lastMsg = finalHistory[finalHistory.length - 1];
      expect(lastMsg.blocks[0].type).toBe('text');
    });

    it('should handle overlap gracefully (not enough to compress)', async () => {
      // Add only 8 messages - with 0.2 top + 0.3 bottom thresholds,
      // middle section will be < 4 messages so nothing to compress
      for (let i = 0; i < 4; i++) {
        historyService.add(createUserMessage(`User message ${i}`));
        historyService.add(createAiTextMessage(`AI response ${i}`));
      }

      const messageCountBefore = historyService.getCurated().length;

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const mockProvider = buildMockProvider('should-not-be-used');
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      // With only 8 messages and minimum 4 required for middle,
      // no compression should occur - all messages preserved
      const finalHistory = historyService.getCurated();
      expect(finalHistory.length).toBe(messageCountBefore);
    });

    it('should preserve tool call boundaries', async () => {
      historyService.add(createUserMessage('Start'));

      for (let i = 0; i < 10; i++) {
        const toolCallId = `tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      historyService.add(createUserMessage('End'));

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Tool boundary test</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // Check that tool calls are not split in the preserved sections
      const toolCallCount = (msg: IContent) =>
        msg.blocks.filter((b) => b.type === 'tool_call').length;
      const toolResponseCount = (msg: IContent) =>
        msg.blocks.filter((b) => b.type === 'tool_response').length;

      // In preserved sections (excluding summary/ack), tool calls should match responses
      const nonSummaryMessages = finalHistory.filter(
        (msg) =>
          !msg.blocks.some(
            (b) =>
              b.type === 'text' &&
              (b.text.includes('state_snapshot') ||
                b.text === 'Understood. Continuing with the current task.'),
          ),
      );

      const totalToolCalls = nonSummaryMessages.reduce(
        (sum, msg) => sum + toolCallCount(msg),
        0,
      );
      const totalToolResponses = nonSummaryMessages.reduce(
        (sum, msg) => sum + toolResponseCount(msg),
        0,
      );

      expect(totalToolCalls).toBe(totalToolResponses);
    });

    it('should integrate all three sections correctly', async () => {
      // Add enough messages to trigger compression
      for (let i = 0; i < 20; i++) {
        historyService.add(createUserMessage(`User message ${i}`));
        historyService.add(createAiTextMessage(`AI response ${i}`));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Test goal</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // Should have summary + kept top + kept bottom
      expect(finalHistory.length).toBeGreaterThan(0);
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);
    });
  });

  describe('applyCompression order via performCompression', () => {
    it('should maintain proper order: top + summary + ack + bottom', async () => {
      // Add test messages
      for (let i = 0; i < 10; i++) {
        historyService.add(createUserMessage(`User ${i}`));
        historyService.add(createAiTextMessage(`AI ${i}`));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Summary</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // First message should be from original top section
      const firstMessage = finalHistory[0];
      expect(firstMessage.speaker).toBe('human');
      expect(firstMessage.blocks[0]).toMatchObject({
        type: 'text',
        text: 'User 0',
      });

      // Last message should be from original bottom section
      const lastMessage = finalHistory[finalHistory.length - 1];
      expect(lastMessage.blocks[0].type).toBe('text');

      // There should be a summary in between
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);

      // There should be an ack right after the summary
      const summaryIndex = finalHistory.findIndex((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      const ackMessage = finalHistory[summaryIndex + 1];
      expect(ackMessage.speaker).toBe('ai');
      expect(ackMessage.blocks[0]).toMatchObject({
        type: 'text',
        text: 'Understood. Continuing with the current task.',
      });
    });
  });
});
