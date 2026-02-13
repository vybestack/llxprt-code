/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P14
 * @requirement REQ-CS-006.1, REQ-CS-002.9
 *
 * Compression boundary tests updated for the strategy pattern refactor.
 * The boundary logic (adjustForToolCallBoundary) is now in compression/utils.ts
 * and is tested directly in compression/utils.test.ts.
 *
 * These integration tests verify that tool-call boundaries are respected
 * through the public performCompression() / middle-out strategy interface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChat } from '../geminiChat.js';
import { HistoryService } from '../../services/history/HistoryService.js';
import type { IContent } from '../../services/history/IContent.js';
import { createAgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../../runtime/createAgentRuntimeContext.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { ContentGenerator } from '../contentGenerator.js';
import { adjustForToolCallBoundary } from '../compression/utils.js';

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

function buildRuntimeContext(
  historyService: HistoryService,
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
      preserveThreshold: 0.2,
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

describe('Compression Boundary Logic (Issue #982)', () => {
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

  describe('adjustForToolCallBoundary (unit via compression/utils)', () => {
    it('should not push splitIndex past the end of history', () => {
      const history: IContent[] = [];
      for (let i = 0; i < 10; i++) {
        const toolCallId = `tool-call-${i}`;
        history.push(createToolCallAiMessage([toolCallId]));
        history.push(createToolResponseMessage(toolCallId));
      }

      const initialSplitIndex = Math.floor(history.length * 0.8);
      const adjustedIndex = adjustForToolCallBoundary(
        history,
        initialSplitIndex,
      );

      expect(adjustedIndex).toBeLessThanOrEqual(history.length);
      expect(adjustedIndex).toBeGreaterThanOrEqual(0);
    });

    it('should find valid split point when initial split is inside tool response sequence', () => {
      const history: IContent[] = [
        createUserMessage('Initial'),
        createAiTextMessage('Response'),
      ];

      for (let i = 0; i < 5; i++) {
        const toolCallId = `tool-call-${i}`;
        history.push(createToolCallAiMessage([toolCallId]));
        history.push(createToolResponseMessage(toolCallId));
      }

      const toolResponseIndex = history.findIndex((c) => c.speaker === 'tool');
      expect(toolResponseIndex).toBeGreaterThan(-1);

      const adjustedIndex = adjustForToolCallBoundary(
        history,
        toolResponseIndex,
      );

      expect(adjustedIndex).toBeLessThanOrEqual(history.length);
      const messageAtAdjusted =
        adjustedIndex < history.length ? history[adjustedIndex] : null;
      expect(
        messageAtAdjusted === null || messageAtAdjusted.speaker !== 'tool',
      ).toBe(true);
    });

    it('should handle history with only tool calls and responses', () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        const toolCallId = `tool-call-${i}`;
        history.push(createToolCallAiMessage([toolCallId]));
        history.push(createToolResponseMessage(toolCallId));
      }

      const midpoint = Math.floor(history.length / 2);
      const adjusted = adjustForToolCallBoundary(history, midpoint);

      expect(adjusted).toBeGreaterThanOrEqual(0);
      expect(adjusted).toBeLessThanOrEqual(history.length);
    });
  });

  describe('performCompression with tool-heavy history', () => {
    it('should compress when context has tool-dominated history', async () => {
      for (let i = 0; i < 100; i++) {
        historyService.add(createUserMessage(`User message ${i}`));
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Tool heavy</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      const beforeCount = historyService.getCurated().length;
      await chat.performCompression('test-prompt-id');
      const afterCount = historyService.getCurated().length;

      expect(afterCount).toBeLessThan(beforeCount);

      const finalHistory = historyService.getCurated();
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);
    });

    it('should preserve tool call/response pairs in kept sections', async () => {
      for (let i = 0; i < 20; i++) {
        historyService.add(createUserMessage(`Message ${i}`));
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Boundary preserve</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // In the preserved sections (non-summary), tool calls should have matching responses
      const nonSummary = finalHistory.filter(
        (msg) =>
          !msg.blocks.some(
            (b) =>
              b.type === 'text' &&
              (b.text.includes('state_snapshot') ||
                b.text === 'Understood. Continuing with the current task.'),
          ),
      );

      const toKeepToolCalls = nonSummary.filter(
        (c) =>
          c.speaker === 'ai' && c.blocks.some((b) => b.type === 'tool_call'),
      );
      const toKeepToolResponses = nonSummary.filter(
        (c) => c.speaker === 'tool',
      );

      for (const aiMsg of toKeepToolCalls) {
        const callIds = aiMsg.blocks
          .filter((b) => b.type === 'tool_call')
          .map((b) => (b as { id: string }).id);

        for (const callId of callIds) {
          const hasResponse = toKeepToolResponses.some((toolMsg) =>
            toolMsg.blocks.some(
              (b) =>
                b.type === 'tool_response' &&
                (b as { callId: string }).callId === callId,
            ),
          );
          expect(hasResponse).toBe(true);
        }
      }
    });

    it('should handle history with continuous tool call/response pairs', async () => {
      historyService.add(createUserMessage('Initial request'));
      historyService.add(createAiTextMessage('I will help'));

      for (let i = 0; i < 12; i++) {
        const toolCallId = `continuous-tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Continuous tools</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      const beforeCount = historyService.getCurated().length;
      await chat.performCompression('test-prompt-id');
      const afterCount = historyService.getCurated().length;

      // Should have compressed (or at minimum, not crashed)
      expect(afterCount).toBeLessThanOrEqual(beforeCount);
    });

    it('should handle edge case where split falls inside long tool sequence', async () => {
      for (let i = 0; i < 5; i++) {
        historyService.add(createUserMessage(`Request ${i}`));
        historyService.add(createAiTextMessage(`Response ${i}`));
      }

      for (let i = 0; i < 20; i++) {
        const toolCallId = `long-sequence-tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const curated = historyService.getCurated();
      expect(curated.length).toBeGreaterThan(40);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Long tool seq</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);
    });

    it('should compress old tool pairs when recent history is all tool calls (reproduces issue #982)', async () => {
      historyService.add(createUserMessage('Start long session'));
      historyService.add(createAiTextMessage('Beginning work'));

      for (let i = 0; i < 100; i++) {
        const toolCallId = `session-tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const curated = historyService.getCurated();
      expect(curated.length).toBe(202);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Issue 982</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();
      // Should have compressed: fewer messages than 202
      expect(finalHistory.length).toBeLessThan(202);
    });

    it('should not crash with edge case histories', async () => {
      historyService.add(createUserMessage('Start'));
      historyService.add(createAiTextMessage('Beginning'));
      historyService.add(
        createToolCallAiMessage(['p1', 'p2', 'p3', 'p4', 'p5']),
      );
      for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
        historyService.add(createToolResponseMessage(id));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Edge case</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      // Should not throw - small history may or may not compress
      await expect(
        chat.performCompression('test-prompt-id'),
      ).resolves.not.toThrow();
    });
  });
});
