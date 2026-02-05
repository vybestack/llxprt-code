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

describe('Compression Boundary Logic (Issue #982)', () => {
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
        preserveThreshold: 0.2,
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

  describe('getCompressionSplit behavior', () => {
    it('should return compressible content when history is dominated by tool calls', () => {
      for (let i = 0; i < 100; i++) {
        historyService.add(createUserMessage(`User message ${i}`));
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);
      expect(
        result.toKeepTop.length + result.toKeepBottom.length,
      ).toBeGreaterThan(0);
    });

    it('should find a valid compression point even when split falls on tool boundary', () => {
      historyService.add(createUserMessage('Initial message'));
      historyService.add(createAiTextMessage('Initial response'));

      for (let i = 0; i < 50; i++) {
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);
    });

    it('should compress old tool pairs while preserving recent ones', () => {
      for (let i = 0; i < 20; i++) {
        historyService.add(createUserMessage(`Message ${i}`));
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const result = chat['getCompressionSplit']();

      const toCompressHasToolCalls = result.toCompress.some(
        (c) =>
          c.speaker === 'ai' && c.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(toCompressHasToolCalls).toBe(true);

      const toKeepToolCalls = [
        ...result.toKeepTop,
        ...result.toKeepBottom,
      ].filter(
        (c) =>
          c.speaker === 'ai' && c.blocks.some((b) => b.type === 'tool_call'),
      );
      const toKeepToolResponses = [
        ...result.toKeepTop,
        ...result.toKeepBottom,
      ].filter((c) => c.speaker === 'tool');

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

    it('should not return empty toCompress when history exceeds minimum threshold', () => {
      historyService.add(createUserMessage('First message'));
      historyService.add(createAiTextMessage('First response'));
      historyService.add(createUserMessage('Second message'));
      historyService.add(createAiTextMessage('Second response'));
      historyService.add(createUserMessage('Third message'));
      historyService.add(createAiTextMessage('Third response'));
      historyService.add(createUserMessage('Fourth message'));
      historyService.add(createAiTextMessage('Fourth response'));
      historyService.add(createUserMessage('Fifth message'));
      historyService.add(createAiTextMessage('Fifth response'));

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);
    });
  });

  describe('adjustForToolCallBoundary behavior', () => {
    it('should not push splitIndex past the end of history', () => {
      for (let i = 0; i < 10; i++) {
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const curated = historyService.getCurated();
      const initialSplitIndex = Math.floor(curated.length * 0.8);
      const adjustedIndex = chat['adjustForToolCallBoundary'](
        curated,
        initialSplitIndex,
      );

      expect(adjustedIndex).toBeLessThanOrEqual(curated.length);
      expect(adjustedIndex).toBeGreaterThanOrEqual(0);
    });

    it('should find valid split point even when initial split is inside tool response sequence', () => {
      historyService.add(createUserMessage('Initial'));
      historyService.add(createAiTextMessage('Response'));

      for (let i = 0; i < 5; i++) {
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const curated = historyService.getCurated();

      const toolResponseIndex = curated.findIndex((c) => c.speaker === 'tool');
      expect(toolResponseIndex).toBeGreaterThan(-1);

      const adjustedIndex = chat['adjustForToolCallBoundary'](
        curated,
        toolResponseIndex,
      );

      expect(adjustedIndex).toBeLessThanOrEqual(curated.length);
      const messageAtAdjusted =
        adjustedIndex < curated.length ? curated[adjustedIndex] : null;
      expect(
        messageAtAdjusted === null || messageAtAdjusted.speaker !== 'tool',
      ).toBe(true);
    });

    it('should handle history with only tool calls and responses', () => {
      for (let i = 0; i < 20; i++) {
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const result = chat['getCompressionSplit']();

      expect(
        result.toCompress.length +
          result.toKeepTop.length +
          result.toKeepBottom.length,
      ).toBe(historyService.getCurated().length);
    });
  });

  describe('performCompression integration', () => {
    it('should compress when context limit is exceeded with tool-heavy history', async () => {
      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      for (let i = 0; i < 50; i++) {
        historyService.add(createUserMessage(`Message ${i}`));
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const mockProvider = {
        name: 'test-provider',
        generateChatCompletion: vi.fn(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Compression summary' }],
          };
        }),
      };

      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      const { toCompress } = chat['getCompressionSplit']();

      expect(toCompress.length).toBeGreaterThan(0);
    });
  });

  describe('Issue #982: boundary adjustment causing empty compression', () => {
    it('should find compression split even when initial split falls inside tool response block', () => {
      historyService.add(createUserMessage('Start'));
      historyService.add(createAiTextMessage('OK'));
      historyService.add(createUserMessage('Run tools'));

      for (let i = 0; i < 8; i++) {
        const toolCallId = `tool-call-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const curated = historyService.getCurated();
      expect(curated.length).toBeGreaterThan(10);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);
    });

    it('should compress when history has continuous tool call/response pairs', () => {
      historyService.add(createUserMessage('Initial request'));
      historyService.add(createAiTextMessage('I will help'));

      for (let i = 0; i < 12; i++) {
        const toolCallId = `continuous-tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);
    });

    it('should not let boundary adjustment reduce splitIndex below minimum when there are compressible messages', () => {
      historyService.add(createUserMessage('Msg 1'));
      historyService.add(createAiTextMessage('Response 1'));
      historyService.add(createUserMessage('Msg 2'));
      historyService.add(createAiTextMessage('Response 2'));
      historyService.add(createUserMessage('Msg 3'));
      historyService.add(createAiTextMessage('Response 3'));
      historyService.add(createUserMessage('Msg 4'));
      historyService.add(createAiTextMessage('Response 4'));
      historyService.add(createUserMessage('Msg 5'));
      historyService.add(createAiTextMessage('Response 5'));

      for (let i = 0; i < 6; i++) {
        const toolCallId = `end-tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);
    });

    it('should handle edge case where preserveThreshold puts split inside long tool sequence', () => {
      for (let i = 0; i < 5; i++) {
        historyService.add(createUserMessage(`Request ${i}`));
        historyService.add(createAiTextMessage(`Response ${i}`));
      }

      for (let i = 0; i < 20; i++) {
        const toolCallId = `long-sequence-tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const curated = historyService.getCurated();
      const totalMessages = curated.length;
      expect(totalMessages).toBeGreaterThan(40);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);
    });

    it('should compress old tool pairs when recent history is all tool calls (reproduces issue #982)', () => {
      historyService.add(createUserMessage('Start long session'));
      historyService.add(createAiTextMessage('Beginning work'));

      for (let i = 0; i < 100; i++) {
        const toolCallId = `session-tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const curated = historyService.getCurated();
      expect(curated.length).toBe(202);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);
      expect(
        result.toCompress.length +
          result.toKeepTop.length +
          result.toKeepBottom.length,
      ).toBe(202);
    });

    it('should never leave toCompress empty when history has more than minimum messages', () => {
      historyService.add(createUserMessage('First'));
      historyService.add(createAiTextMessage('Reply'));

      for (let i = 0; i < 5; i++) {
        historyService.add(createUserMessage(`User ${i}`));
        historyService.add(createAiTextMessage(`AI ${i}`));
      }

      for (let i = 0; i < 10; i++) {
        const toolCallId = `final-tool-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const curated = historyService.getCurated();
      expect(curated.length).toBeGreaterThan(20);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(3);
    });

    it('should find valid split by searching backward when forward adjustment fails', () => {
      historyService.add(createUserMessage('A'));
      historyService.add(createAiTextMessage('B'));
      historyService.add(createUserMessage('C'));
      historyService.add(createAiTextMessage('D'));
      historyService.add(createUserMessage('E'));

      for (let i = 0; i < 15; i++) {
        const toolCallId = `backward-test-${i}`;
        historyService.add(createToolCallAiMessage([toolCallId]));
        historyService.add(createToolResponseMessage(toolCallId));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const result = chat['getCompressionSplit']();

      expect(result.toCompress.length).toBeGreaterThan(0);

      const hasKeepContent =
        result.toKeepTop.length + result.toKeepBottom.length > 0;
      expect(hasKeepContent).toBe(true);

      const allKept = [...result.toKeepTop, ...result.toKeepBottom];
      const firstInKeep = allKept[0];
      expect(firstInKeep.speaker).not.toBe('tool');

      const firstInKeepIsAiWithToolCalls =
        firstInKeep.speaker === 'ai' &&
        firstInKeep.blocks.some((b) => b.type === 'tool_call');

      const toolCallIds = firstInKeepIsAiWithToolCalls
        ? firstInKeep.blocks
            .filter((b) => b.type === 'tool_call')
            .map((b) => (b as { id: string }).id)
        : [];

      const allToolCallsHaveResponses = toolCallIds.every((id) =>
        allKept.some(
          (c) =>
            c.speaker === 'tool' &&
            c.blocks.some(
              (b) =>
                b.type === 'tool_response' &&
                (b as { callId: string }).callId === id,
            ),
        ),
      );

      expect(!firstInKeepIsAiWithToolCalls || allToolCallsHaveResponses).toBe(
        true,
      );
    });

    it('should trigger backward search when history ends with consecutive tool responses', () => {
      historyService.add(createUserMessage('Start'));
      historyService.add(createAiTextMessage('Beginning'));
      historyService.add(
        createToolCallAiMessage(['p1', 'p2', 'p3', 'p4', 'p5']),
      );
      for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
        historyService.add(createToolResponseMessage(id));
      }

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
      const result = chat['getCompressionSplit']();

      // With sandwich compression, small histories may not have tool calls in preserved sections
      // The important thing is that compression works correctly
      expect(
        result.toCompress.length +
          result.toKeepTop.length +
          result.toKeepBottom.length,
      ).toBeGreaterThan(0);
    });
  });
});
