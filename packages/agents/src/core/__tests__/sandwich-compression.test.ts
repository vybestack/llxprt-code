import { curatedHistoryForTest } from '@vybestack/llxprt-code-test-utils/core/curated-history-fixture.js';
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
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { ChatSession } from '../chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
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
function legacyTest0() {
  const defaultThreshold =
    legacySuite1_runtimeContext.ephemerals.topPreserveThreshold();
  expect(defaultThreshold).toBe(0.2);
}
function legacyTest1() {
  const customContext = buildRuntimeContext(new HistoryService(), {
    topPreserveThreshold: 0.25,
  });
  const customThreshold = customContext.ephemerals.topPreserveThreshold();
  expect(customThreshold).toBe(0.25);
}
async function legacyTest3() {
  const { messageCountBefore, finalHistory, hasSummary, lastMsg } =
    await legacySuite3_observeProduceCorrectTopBottomSplitFor20MessagesWithDefaultThresholds();
  expect(messageCountBefore).toBe(20);
  expect(finalHistory.length).toBeLessThan(messageCountBefore);
  expect(finalHistory[0].speaker).toBe('human');
  expect(finalHistory[0].blocks[0]).toMatchObject({
    type: 'text',
    text: 'User message 0',
  });
  expect(hasSummary).toBe(true);
  expect(lastMsg.blocks[0].type).toBe('text');
}
async function legacyTest4() {
  // Add only 8 messages - with 0.2 top + 0.3 bottom thresholds,
  // the middle-out middle section will be < 4 messages (structural no-op).
  // Per issue #2602, middle-out no-op now routes to one-shot, which can
  // compress the older prefix while preserving the recent tail.
  for (let i = 0; i < 4; i++) {
    legacySuite0_historyService.add(createUserMessage(`User message ${i}`));
    legacySuite0_historyService.add(createAiTextMessage(`AI response ${i}`));
  }
  const messageCountBefore = curatedHistoryForTest(
    legacySuite0_historyService,
  ).length;
  const chat = new ChatSession(
    legacySuite1_runtimeContext,
    legacySuite2_mockContentGenerator,
    {},
    [],
  );
  const mockProvider = buildMockProvider('one-shot fallback summary');
  vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
    mockProvider as never,
  );
  vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);
  const result = await chat.performCompression('test-prompt-id');
  // Middle-out could not form a valid middle, so one-shot ran as fallback
  // and compressed the history (fewer messages than before).
  expect(result).toBe(PerformCompressionResult.COMPRESSED);
  const finalHistory = curatedHistoryForTest(legacySuite0_historyService);
  expect(finalHistory.length).toBeLessThan(messageCountBefore);
}
async function legacyTest5() {
  const { totalToolCalls, totalToolResponses } =
    await legacySuite4_observePreserveToolCallBoundaries();
  expect(totalToolCalls).toBe(totalToolResponses);
}
async function legacyTest6() {
  const { finalHistory, hasSummary } =
    await legacySuite5_observeIntegrateAllThreeSectionsCorrectly();
  expect(finalHistory.length).toBeGreaterThan(0);
  expect(hasSummary).toBe(true);
}
const legacySuite3_observeProduceCorrectTopBottomSplitFor20MessagesWithDefaultThresholds =
  async () => {
    // Add 20 messages to history (10 user + 10 AI)
    for (let i = 0; i < 10; i++) {
      legacySuite0_historyService.add(createUserMessage(`User message ${i}`));
      legacySuite0_historyService.add(createAiTextMessage(`AI response ${i}`));
    }
    const messageCountBefore = curatedHistoryForTest(
      legacySuite0_historyService,
    ).length;
    const chat = new ChatSession(
      legacySuite1_runtimeContext,
      legacySuite2_mockContentGenerator,
      {},
      [],
    );
    const summaryText =
      '<state_snapshot><overall_goal>Test goal</overall_goal></state_snapshot>';
    const mockProvider = buildMockProvider(summaryText);
    vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
      mockProvider as never,
    );
    vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);
    await chat.performCompression('test-prompt-id');
    const finalHistory = curatedHistoryForTest(legacySuite0_historyService);
    // Should have: top preserved (4) + summary (1) + ack (1) + bottom preserved (6) = 12
    // Top 20% of 20 = 4, Bottom 30% of 20 = 6, Middle 10 compressed
    // First message should be the original first user message
    // Should contain the state_snapshot summary
    const hasSummary = finalHistory.some((msg) =>
      msg.blocks.some(
        (b) => b.type === 'text' && b.text.includes('state_snapshot'),
      ),
    );
    // Last message should be from the original bottom section
    const lastMsg = finalHistory[finalHistory.length - 1];
    return { messageCountBefore, finalHistory, hasSummary, lastMsg };
  };
const legacySuite4_observePreserveToolCallBoundaries = async () => {
  legacySuite0_historyService.add(createUserMessage('Start'));
  for (let i = 0; i < 10; i++) {
    const toolCallId = `tool-${i}`;
    legacySuite0_historyService.add(createToolCallAiMessage([toolCallId]));
    legacySuite0_historyService.add(createToolResponseMessage(toolCallId));
  }
  legacySuite0_historyService.add(createUserMessage('End'));
  const chat = new ChatSession(
    legacySuite1_runtimeContext,
    legacySuite2_mockContentGenerator,
    {},
    [],
  );
  const summaryText =
    '<state_snapshot><overall_goal>Tool boundary test</overall_goal></state_snapshot>';
  const mockProvider = buildMockProvider(summaryText);
  vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
    mockProvider as never,
  );
  vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);
  await chat.performCompression('test-prompt-id');
  const finalHistory = curatedHistoryForTest(legacySuite0_historyService);
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
  return { totalToolCalls, totalToolResponses };
};
const legacySuite5_observeIntegrateAllThreeSectionsCorrectly = async () => {
  // Add enough messages to trigger compression
  for (let i = 0; i < 20; i++) {
    legacySuite0_historyService.add(createUserMessage(`User message ${i}`));
    legacySuite0_historyService.add(createAiTextMessage(`AI response ${i}`));
  }
  const chat = new ChatSession(
    legacySuite1_runtimeContext,
    legacySuite2_mockContentGenerator,
    {},
    [],
  );
  const summaryText =
    '<state_snapshot><overall_goal>Test goal</overall_goal></state_snapshot>';
  const mockProvider = buildMockProvider(summaryText);
  vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
    mockProvider as never,
  );
  vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);
  await chat.performCompression('test-prompt-id');
  const finalHistory = curatedHistoryForTest(legacySuite0_historyService);
  // Should have summary + kept top + kept bottom
  const hasSummary = finalHistory.some((msg) =>
    msg.blocks.some(
      (b) => b.type === 'text' && b.text.includes('state_snapshot'),
    ),
  );
  return { finalHistory, hasSummary };
};
async function legacyTest8() {
  const { firstMessage, lastMessage, hasSummary, ackMessage } =
    await legacySuite6_observeMaintainProperOrderTopSummaryAckBottom();
  expect(firstMessage.speaker).toBe('human');
  expect(firstMessage.blocks[0]).toMatchObject({
    type: 'text',
    text: 'User 0',
  });
  expect(lastMessage.blocks[0].type).toBe('text');
  expect(hasSummary).toBe(true);
  expect(ackMessage.speaker).toBe('ai');
  expect(ackMessage.blocks[0].type).toBe('text');
  expect(
    (
      ackMessage.blocks[0] as {
        text: string;
      }
    ).text,
  ).toContain('Understood.');
  expect(
    (
      ackMessage.blocks[0] as {
        text: string;
      }
    ).text,
  ).toContain('Continuing with the current task.');
}
const legacySuite6_observeMaintainProperOrderTopSummaryAckBottom = async () => {
  // Add test messages
  for (let i = 0; i < 10; i++) {
    legacySuite0_historyService.add(createUserMessage(`User ${i}`));
    legacySuite0_historyService.add(createAiTextMessage(`AI ${i}`));
  }
  const chat = new ChatSession(
    legacySuite1_runtimeContext,
    legacySuite2_mockContentGenerator,
    {},
    [],
  );
  const summaryText =
    '<state_snapshot><overall_goal>Summary</overall_goal></state_snapshot>';
  const mockProvider = buildMockProvider(summaryText);
  vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
    mockProvider as never,
  );
  vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);
  await chat.performCompression('test-prompt-id');
  const finalHistory = curatedHistoryForTest(legacySuite0_historyService);
  // First message should be from original top section
  const firstMessage = finalHistory[0];
  // Last message should be from original bottom section
  const lastMessage = finalHistory[finalHistory.length - 1];
  // There should be a summary in between
  const hasSummary = finalHistory.some((msg) =>
    msg.blocks.some(
      (b) => b.type === 'text' && b.text.includes('state_snapshot'),
    ),
  );
  // There should be an ack right after the summary
  const summaryIndex = finalHistory.findIndex((msg) =>
    msg.blocks.some(
      (b) => b.type === 'text' && b.text.includes('state_snapshot'),
    ),
  );
  const ackMessage = finalHistory[summaryIndex + 1];
  return { firstMessage, lastMessage, hasSummary, ackMessage };
};
let legacySuite0_historyService: HistoryService;
let legacySuite1_runtimeContext: AgentRuntimeContext;
let legacySuite2_mockContentGenerator: ContentGenerator;
const legacyHook0 = () => {
  vi.clearAllMocks();
  legacySuite0_historyService = new HistoryService();
  legacySuite1_runtimeContext = buildRuntimeContext(
    legacySuite0_historyService,
  );
  legacySuite2_mockContentGenerator = {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(100),
    embedContent: vi.fn(),
  } as unknown as ContentGenerator;
};
describe('Sandwich Compression (Issue #1011) > topPreserveThreshold ephemeral setting / should return correct default value of 0.2 when not specified in settings', () => {
  beforeEach(legacyHook0);
  it('should return correct default value of 0.2 when not specified in settings', () => {
    expect(legacyTest0).not.toThrow();
  });
});
describe('Sandwich Compression (Issue #1011) > topPreserveThreshold ephemeral setting / should return override value when specified in settings', () => {
  beforeEach(legacyHook0);
  it('should return override value when specified in settings', () => {
    expect(legacyTest1).not.toThrow();
  });
});
describe('Sandwich Compression (Issue #1011) > performCompression integration / should produce correct top/bottom split for 20 messages with default thresholds', () => {
  beforeEach(legacyHook0);
  it('should produce correct top/bottom split for 20 messages with default thresholds', async () => {
    await expect(legacyTest3()).resolves.toBeUndefined();
  });
});
describe('Sandwich Compression (Issue #1011) > performCompression integration / routes middle-out structural no-op to one-shot fallback (issue #2602)', () => {
  beforeEach(legacyHook0);
  it('routes middle-out structural no-op to one-shot fallback (issue #2602)', async () => {
    await expect(legacyTest4()).resolves.toBeUndefined();
  });
});
describe('Sandwich Compression (Issue #1011) > performCompression integration / should preserve tool call boundaries', () => {
  beforeEach(legacyHook0);
  it('should preserve tool call boundaries', async () => {
    await expect(legacyTest5()).resolves.toBeUndefined();
  });
});
describe('Sandwich Compression (Issue #1011) > performCompression integration / should integrate all three sections correctly', () => {
  beforeEach(legacyHook0);
  it('should integrate all three sections correctly', async () => {
    await expect(legacyTest6()).resolves.toBeUndefined();
  });
});
describe('Sandwich Compression (Issue #1011) > applyCompression order via performCompression / should maintain proper order: top + summary + ack + bottom', () => {
  beforeEach(legacyHook0);
  it('should maintain proper order: top + summary + ack + bottom', async () => {
    await expect(legacyTest8()).resolves.toBeUndefined();
  });
});
