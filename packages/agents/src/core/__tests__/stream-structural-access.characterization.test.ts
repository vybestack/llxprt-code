/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  makeRuntimeContext,
  getRecordedHistoryText,
  getRecordedThinkingBlocks,
} from './structural-history-fixture.js';

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import {
  extractResponseTextFromBlocks,
  analyzeBlocksOutcome,
  recordHistoryWithUsage,
} from '../streamValidationHelpers.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { ConversationManager } from '../ConversationManager.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  ContentBlock,
  UsageStats,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { CompressionHandler } from '../../compression/CompressionHandler.js';
// ---------------------------------------------------------------------------
// REQ-005.3: streamValidationHelpers accumulation
// (imports DebugLogger and CompressionHandler type — declared at top of file)
// ---------------------------------------------------------------------------

function makeCompressionHandlerStub(
  lastPromptTokenCount: number | null,
): CompressionHandler {
  return {
    lastPromptTokenCount,
  } as unknown as CompressionHandler;
}

describe('REQ-005.3: extractResponseTextFromBlocks', () => {
  it('extracts visible text from text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'World' },
    ];
    expect(extractResponseTextFromBlocks(blocks)).toBe('Hello World');
  });

  it('excludes thinking blocks from text extraction', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'thinking',
        thought: 'internal reasoning',
        isHidden: true,
        sourceField: 'thought',
      },
      { type: 'text', text: 'visible answer' },
    ];
    expect(extractResponseTextFromBlocks(blocks)).toBe('visible answer');
  });

  it('excludes tool call blocks from text extraction', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Calling tool' },
      { type: 'tool_call', id: '1', name: 'search', parameters: {} },
    ];
    expect(extractResponseTextFromBlocks(blocks)).toBe('Calling tool');
  });

  it('returns empty string for empty blocks', () => {
    expect(extractResponseTextFromBlocks([])).toBe('');
  });

  it('skips empty text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: '' },
      { type: 'text', text: 'non-empty' },
    ];
    expect(extractResponseTextFromBlocks(blocks)).toBe('non-empty');
  });
});

describe('REQ-005.3: analyzeBlocksOutcome', () => {
  it('detects visible text in blocks', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hello' }];
    const outcome = analyzeBlocksOutcome(blocks, false);
    expect(outcome.hasVisibleText).toBe(true);
    expect(outcome.isActionable).toBe(true);
  });

  it('detects tool calls in blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_call', id: '1', name: 'tool', parameters: {} },
    ];
    const outcome = analyzeBlocksOutcome(blocks, false);
    expect(outcome.hasToolCalls).toBe(true);
    expect(outcome.isActionable).toBe(true);
  });

  it('detects thinking blocks when includeThoughts=true', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'thinking',
        thought: 'hmm',
        isHidden: true,
        sourceField: 'thought',
      },
    ];
    const outcome = analyzeBlocksOutcome(blocks, true);
    expect(outcome.hasThinking).toBe(true);
  });

  it('does NOT detect thinking blocks when includeThoughts=false', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'thinking',
        thought: 'hmm',
        isHidden: true,
        sourceField: 'thought',
      },
    ];
    const outcome = analyzeBlocksOutcome(blocks, false);
    expect(outcome.hasThinking).toBe(false);
  });

  it('empty blocks yield no outcome flags', () => {
    const outcome = analyzeBlocksOutcome([], false);
    expect(outcome.hasVisibleText).toBe(false);
    expect(outcome.hasThinking).toBe(false);
    expect(outcome.hasToolCalls).toBe(false);
    expect(outcome.isActionable).toBe(false);
  });
});

describe('REQ-005.3: recordHistoryWithUsage accumulation', () => {
  let historyService: HistoryService;
  let logger: DebugLogger;

  beforeEach(() => {
    historyService = new HistoryService();
    logger = new DebugLogger('p14-req0053');
  });

  async function recordAcc(
    hs: HistoryService,
    ctx: AgentRuntimeContext,
    blocks: ContentBlock[],
    finishReason: ModelOutput['finishReason'],
    usage?: UsageStats,
  ): Promise<void> {
    const mgr = new ConversationManager(hs, ctx);
    const compHandler = makeCompressionHandlerStub(null);
    const acc: ModelOutput = {
      content: {
        speaker: 'ai',
        blocks,
      },
    };
    if (finishReason !== undefined) {
      acc.finishReason = finishReason;
    }
    if (usage) {
      acc.usage = usage;
    }
    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hi' }],
    };
    await recordHistoryWithUsage(
      logger,
      mgr,
      hs,
      compHandler,
      ctx,
      userInput,
      acc,
    );
  }

  it('records accumulated text blocks to history', async () => {
    const ctx = makeRuntimeContext(true);
    await recordAcc(
      historyService,
      ctx,
      [{ type: 'text', text: 'Hello World' }],
      'stop',
    );

    const recordedText = getRecordedHistoryText(historyService);
    expect(recordedText).toBe('Hello World');
  });

  it('records usage metadata on the AI entry', async () => {
    const ctx = makeRuntimeContext(true);
    await recordAcc(
      historyService,
      ctx,
      [{ type: 'text', text: 'answer' }],
      'stop',
      { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    );

    const aiEntries = historyService.getAll().filter((c) => c.speaker === 'ai');
    expect(aiEntries.length).toBeGreaterThan(0);
    expect(aiEntries[0].metadata?.usage?.totalTokens).toBe(15);
  });

  it('filters thinking blocks from history when includeThoughts=false', async () => {
    const ctx = makeRuntimeContext(false);
    await recordAcc(
      historyService,
      ctx,
      [
        {
          type: 'thinking',
          thought: 'hidden',
          isHidden: true,
          sourceField: 'thought',
        },
        { type: 'text', text: 'visible' },
      ],
      'stop',
    );

    const thinkingBlocks = getRecordedThinkingBlocks(historyService);
    expect(thinkingBlocks).toHaveLength(0);
    expect(getRecordedHistoryText(historyService)).toBe('visible');
  });

  it('syncs prompt token count to history service when usage provided', async () => {
    const ctx = makeRuntimeContext(true);
    const promptTokens = 42;
    await recordAcc(
      historyService,
      ctx,
      [{ type: 'text', text: 'answer' }],
      'stop',
      { promptTokens, completionTokens: 5, totalTokens: 47 },
    );

    // syncTotalTokens is an observable side-effect; the history service
    // stores it. Verify via the getTotalTokens method.
    const totalTokens = historyService.getTotalTokens();
    expect(totalTokens).toBe(promptTokens);
  });

  it('records AFC history atomically without duplicating the current user', async () => {
    const ctx = makeRuntimeContext(true);
    const mgr = new ConversationManager(historyService, ctx);
    const prior: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'prior' }],
    };
    historyService.add(prior, 'test-model');
    const currentUser: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'current' }],
    };
    const acc: ModelOutput = {
      content: {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'final' }],
      },
      afcHistory: [
        currentUser,
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'intermediate' }],
        },
      ],
    };

    await recordHistoryWithUsage(
      logger,
      mgr,
      historyService,
      makeCompressionHandlerStub(null),
      ctx,
      currentUser,
      acc,
    );

    expect(
      historyService.getAll().map((content) => ({
        speaker: content.speaker,
        text: content.blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      })),
    ).toStrictEqual([
      { speaker: 'human', text: 'prior' },
      { speaker: 'human', text: 'current' },
      { speaker: 'ai', text: 'intermediate' },
      { speaker: 'ai', text: 'final' },
    ]);
  });

  it('does not replay an existing prefix from full AFC history', async () => {
    const ctx = makeRuntimeContext(true);
    const mgr = new ConversationManager(historyService, ctx);
    const priorHuman: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'prior question' }],
    };
    const priorAi: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'prior answer' }],
    };
    historyService.add(
      { ...priorHuman, metadata: { turnId: 'stored-human-turn' } },
      'test-model',
    );
    historyService.add(
      {
        ...priorAi,
        metadata: { turnId: 'stored-ai-turn', model: 'test-model' },
      },
      'test-model',
    );
    const currentUser: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'current question' }],
    };

    await recordHistoryWithUsage(
      logger,
      mgr,
      historyService,
      makeCompressionHandlerStub(null),
      ctx,
      currentUser,
      {
        content: {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'final answer' }],
        },
        afcHistory: [
          { ...priorHuman, metadata: { turnId: 'provider-human-turn' } },
          { ...priorAi, metadata: { turnId: 'provider-ai-turn' } },
          currentUser,
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'intermediate' }],
          },
        ],
      },
    );

    expect(
      historyService.getAll().map((content) =>
        content.blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      ),
    ).toStrictEqual([
      'prior question',
      'prior answer',
      'current question',
      'intermediate',
      'final answer',
    ]);
  });
});

// ---------------------------------------------------------------------------
// REQ-005.3 PROPERTY TESTS
// ---------------------------------------------------------------------------

describe('REQ-005.3: extractResponseTextFromBlocks + analyzeBlocksOutcome (property)', () => {
  it('text extraction yields concatenation of all text blocks (property)', () => {
    const textArb = fc.string({ minLength: 1 }).filter((s) => s.length > 0);
    const blocksArb = fc.array(textArb, { minLength: 1, maxLength: 8 });

    fc.assert(
      fc.property(blocksArb, (texts: string[]) => {
        const blocks: ContentBlock[] = texts.map((t) => ({
          type: 'text' as const,
          text: t,
        }));
        const extracted = extractResponseTextFromBlocks(blocks);
        expect(extracted).toBe(texts.join('').trim());
      }),
    );
  });

  it('hasToolCalls is true iff at least one tool_call block exists (property)', () => {
    const arb = fc.array(
      fc.constantFrom(
        { type: 'text' as const, text: 'a' },
        { type: 'tool_call' as const, id: '1', name: 't', parameters: {} },
        {
          type: 'thinking' as const,
          thought: 'x',
          isHidden: true,
          sourceField: 'thought',
        },
      ),
      { maxLength: 10 },
    );

    fc.assert(
      fc.property(arb, (blocks: ContentBlock[]) => {
        const outcome = analyzeBlocksOutcome(blocks, false);
        const expectedToolCalls = blocks.some((b) => b.type === 'tool_call');
        expect(outcome.hasToolCalls).toBe(expectedToolCalls);
      }),
    );
  });
});
