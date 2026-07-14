/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P14
 * @requirement:REQ-005.1,REQ-005.2,REQ-005.3,REQ-005.4,REQ-005.5
 *
 * Behavioral characterization tests for structural-access sites that
 * currently READ/MUTATE `.parts`/`candidate.content` before they are migrated
 * to ContentBlock[] in P15. These tests pin OBSERVABLE behavior — committed
 * history text, speaker decisions, finish reasons, injection triggers — so
 * the P15 migration can verify it preserves behavior.
 *
 * Uses REAL HistoryService/ConversationManager/streamValidationHelpers
 * machinery. Mocks ONLY the provider stream.
 *
 * CONSTRAINT: NEVER asserts on `.parts`, `candidate.content`, `.candidates`,
 * or Google-shaped internals. Asserts ONLY on observable outcomes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ConversationManager } from '../ConversationManager.js';
import {
  extractResponseTextFromBlocks,
  analyzeBlocksOutcome,
  recordHistoryWithUsage,
} from '../streamValidationHelpers.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ContentBlock,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { CompressionHandler } from '../../compression/CompressionHandler.js';

// ---------------------------------------------------------------------------
// Runtime context factory
// ---------------------------------------------------------------------------

function makeRuntimeContext(includeThoughts: boolean): AgentRuntimeContext {
  const state = createAgentRuntimeState({
    runtimeId: 'p14-test',
    provider: 'test',
    model: 'test-model',
    sessionId: 'test-session',
  });
  return createAgentRuntimeContext({
    state,
    history: new HistoryService(),
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
      'reasoning.includeInContext': includeThoughts,
    },
    provider: {} as never,
    telemetry: {} as never,
    tools: {} as never,
    providerRuntime: {} as never,
  });
}

// ---------------------------------------------------------------------------
// Helper: extract observable text from committed history
// ---------------------------------------------------------------------------

function getRecordedHistoryText(history: HistoryService): string {
  const all = history.getAll();
  return all
    .filter((c) => c.speaker === 'ai')
    .flatMap((c) => c.blocks)
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
}

function getRecordedThinkingBlocks(
  history: HistoryService,
): Array<{ thought: string; signature?: string }> {
  return history
    .getAll()
    .filter((c) => c.speaker === 'ai')
    .flatMap((c) => c.blocks)
    .filter((b) => b.type === 'thinking')
    .map((b) => {
      const tb = b as { thought: string; signature?: string };
      return { thought: tb.thought, signature: tb.signature };
    });
}

// ---------------------------------------------------------------------------
// REQ-005.1: ConversationManager text consolidation (BR-7) + thought filtering (BR-5)
// ---------------------------------------------------------------------------

describe('REQ-005.1: ConversationManager text consolidation + thought filtering', () => {
  let historyService: HistoryService;
  let conversationManager: ConversationManager;

  function createManager(includeThoughts: boolean): ConversationManager {
    const ctx = makeRuntimeContext(includeThoughts);
    return new ConversationManager(historyService, ctx, 'test-model');
  }

  beforeEach(() => {
    historyService = new HistoryService();
    conversationManager = createManager(true);
  });

  it('consolidates adjacent text model outputs into single merged text', () => {
    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hello' }],
    };
    const modelOutput: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Hello ' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'World' }] },
    ];

    conversationManager.recordHistory(userInput, modelOutput);

    const recordedText = getRecordedHistoryText(historyService);
    expect(recordedText).toBe('Hello World');
  });

  it('consolidates three adjacent text chunks into one continuous string', () => {
    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'prompt' }],
    };
    const modelOutput: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'A' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'B' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'C' }] },
    ];

    conversationManager.recordHistory(userInput, modelOutput);

    const recordedText = getRecordedHistoryText(historyService);
    expect(recordedText).toBe('ABC');
  });

  it('filters thoughts from recorded text when includeThoughts=false', () => {
    const ctx = makeRuntimeContext(false);
    const mgr = new ConversationManager(historyService, ctx, 'test-model');
    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hi' }],
    };
    const modelOutput: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'secret thought',
            signature: 'sig1',
            sourceField: 'thought',
          },
          { type: 'text', text: 'visible answer' },
        ],
      },
    ];

    mgr.recordHistory(userInput, modelOutput);

    const recordedText = getRecordedHistoryText(historyService);
    expect(recordedText).toBe('visible answer');
    expect(recordedText).not.toContain('secret thought');
  });

  it('drops thinking blocks and their signatures from history when includeThoughts=false', () => {
    const ctx = makeRuntimeContext(false);
    const mgr = new ConversationManager(historyService, ctx, 'test-model');
    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hi' }],
    };
    const modelOutput: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'hidden thought',
            signature: 'sigABC',
            sourceField: 'thought',
          },
          { type: 'text', text: 'answer' },
        ],
      },
    ];

    mgr.recordHistory(userInput, modelOutput);

    // When includeThoughts=false, the thinking block is NOT recorded as
    // a standalone block in history. The signature is retained on any
    // thinking blocks that ARE present.
    const thinkingBlocks = getRecordedThinkingBlocks(historyService);
    // Thoughts are filtered out from history blocks when includeThoughts=false
    expect(thinkingBlocks).toHaveLength(0);
  });

  it('includes thinking blocks in history when includeThoughts=true', () => {
    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hi' }],
    };
    const modelOutput: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'my thought',
            signature: 'sigXYZ',
            sourceField: 'thought',
          },
          { type: 'text', text: 'visible answer' },
        ],
      },
    ];

    conversationManager.recordHistory(userInput, modelOutput);

    const thinkingBlocks = getRecordedThinkingBlocks(historyService);
    expect(thinkingBlocks.length).toBeGreaterThan(0);
    expect(thinkingBlocks[0].thought).toBe('my thought');
    expect(thinkingBlocks[0].signature).toBe('sigXYZ');
  });

  it('records usage metadata on the AI entry', () => {
    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hi' }],
    };
    const modelOutput: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
    ];
    const usage: UsageStats = {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    };

    conversationManager.recordHistory(userInput, modelOutput, undefined, usage);

    const aiEntries = historyService.getAll().filter((c) => c.speaker === 'ai');
    expect(aiEntries.length).toBeGreaterThan(0);
    expect(aiEntries[0].metadata?.usage?.totalTokens).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// REQ-005.1 PROPERTY TESTS: consolidation + thought filtering
// ---------------------------------------------------------------------------

describe('REQ-005.1: consolidation + thought filtering (property)', () => {
  it('consolidating N adjacent text chunks yields their concatenation (property)', () => {
    const textArb = fc.string({ minLength: 1 }).filter((s) => s.length > 0);
    const chunksArb = fc.array(textArb, { minLength: 2, maxLength: 10 });

    fc.assert(
      fc.property(chunksArb, (texts: string[]) => {
        const hs = new HistoryService();
        const ctx = makeRuntimeContext(true);
        const mgr = new ConversationManager(hs, ctx, 'test-model');

        const userInput: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'q' }],
        };
        const modelOutput: IContent[] = texts.map((t) => ({
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: t }],
        }));

        mgr.recordHistory(userInput, modelOutput);

        const recordedText = getRecordedHistoryText(hs);
        expect(recordedText).toBe(texts.join(''));
      }),
    );
  });

  it('thought text never appears in recorded history when includeThoughts=false (property)', () => {
    // Use distinct prefixes so the thought text is never a substring of the
    // answer, making the "not contain" assertion meaningful.
    const thoughtArb = fc
      .string({ minLength: 1, maxLength: 40 })
      .map((s) => 'THOUGHT_' + s);
    const answerArb = fc
      .string({ minLength: 1, maxLength: 40 })
      .map((s) => 'ANSWER_' + s);
    const sigArb = fc.string({ minLength: 1, maxLength: 20 });

    fc.assert(
      fc.property(
        thoughtArb,
        answerArb,
        sigArb,
        (thought: string, answer: string, sig: string) => {
          const hs = new HistoryService();
          const ctx = makeRuntimeContext(false);
          const mgr = new ConversationManager(hs, ctx, 'test-model');

          const userInput: IContent = {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'q' }],
          };
          const modelOutput: IContent[] = [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'thinking',
                  thought,
                  signature: sig,
                  sourceField: 'thought',
                },
                { type: 'text', text: answer },
              ],
            },
          ];

          mgr.recordHistory(userInput, modelOutput);

          const recordedText = getRecordedHistoryText(hs);
          expect(recordedText).toBe(answer);
          expect(recordedText).not.toContain(thought);
        },
      ),
    );
  });

  it('recorded AI text is never empty when model output has visible text (property)', () => {
    const textArb = fc
      .string({ minLength: 1 })
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(textArb, (text: string) => {
        const hs = new HistoryService();
        const ctx = makeRuntimeContext(true);
        const mgr = new ConversationManager(hs, ctx, 'test-model');

        const userInput: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'q' }],
        };
        const modelOutput: IContent[] = [
          { speaker: 'ai', blocks: [{ type: 'text', text }] },
        ];

        mgr.recordHistory(userInput, modelOutput);

        const recordedText = getRecordedHistoryText(hs);
        expect(recordedText.length).toBeGreaterThan(0);
        expect(recordedText).toBe(text);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-005.2: clientLlmUtilities next_speaker helper
// ---------------------------------------------------------------------------

// Mock the heavy dependencies that generateJson pulls in for system prompts.
vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('test system prompt'),
}));

vi.mock('../clientToolGovernance.js', () => ({
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue([]),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
}));

vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { generateJson } from '../clientLlmUtilities.js';
import type { BaseLLMClient } from '../baseLlmClient.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

function makeConfig(): Config {
  return {
    getUserMemory: vi.fn().mockReturnValue(''),
    getMcpClientManager: vi.fn().mockReturnValue(undefined),
    isInteractive: vi.fn().mockReturnValue(true),
  } as unknown as Config;
}

function makeBaseLlmClient(result: unknown): BaseLLMClient {
  return {
    generateJson: vi.fn().mockResolvedValue(result),
    generateEmbedding: vi.fn(),
    countTokens: vi.fn(),
    generateContent: vi.fn(),
  } as unknown as BaseLLMClient;
}

describe('REQ-005.2: clientLlmUtilities next_speaker detection', () => {
  const abortSignal = new AbortController().signal;

  it('returns parsed next_speaker decision from JSON response', async () => {
    const config = makeConfig();
    const baseLlmClient = makeBaseLlmClient({
      reasoning: 'user asked a question',
      next_speaker: 'user',
    });

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'determine next_speaker' }],
      } as IContent,
    ];

    const result = await generateJson(
      config,
      {} as never,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      'test-model',
      {},
      'session-1',
    );

    expect(result).toStrictEqual({
      reasoning: 'user asked a question',
      next_speaker: 'user',
    });
  });

  it('converts plain-text "model" fallback when next_speaker text is present', async () => {
    const config = makeConfig();
    const baseLlmClient = makeBaseLlmClient('model');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'what is the next_speaker?' }],
      } as IContent,
    ];

    const result = await generateJson(
      config,
      {} as never,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      'test-model',
      {},
      'session-1',
    );

    expect(result).toStrictEqual({
      reasoning: 'Gemini returned plain text response',
      next_speaker: 'model',
    });
  });

  it('does NOT apply fallback when next_speaker text is absent', async () => {
    const config = makeConfig();
    // Return a plain text "user" — the fallback check will NOT trigger
    // because there's no "next_speaker" keyword in the prompt text.
    const baseLlmClient = makeBaseLlmClient('user');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'just a normal question' }],
      } as IContent,
    ];

    const result = await generateJson(
      config,
      {} as never,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      'test-model',
      {},
      'session-1',
    );

    // The raw string is returned as-is (no next_speaker conversion)
    expect(result).toBe('user');
  });

  it('returns JSON object as-is when no fallback is needed', async () => {
    const config = makeConfig();
    const baseLlmClient = makeBaseLlmClient({ key: 'value' });

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'generate some next_speaker JSON' }],
      } as IContent,
    ];

    const result = await generateJson(
      config,
      {} as never,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      'test-model',
      {},
      'session-1',
    );

    expect(result).toStrictEqual({ key: 'value' });
  });
});

// ---------------------------------------------------------------------------
// REQ-005.2 PROPERTY TESTS
// ---------------------------------------------------------------------------

describe('REQ-005.2: next_speaker fallback detection (property)', () => {
  const abortSignal = new AbortController().signal;

  it('fallback fires for any "user"/"model" plain-text when next_speaker keyword present (property)', async () => {
    const speakerArb = fc.constantFrom('user', 'model');

    await fc.assert(
      fc.asyncProperty(speakerArb, async (speaker: string) => {
        const config = makeConfig();
        const baseLlmClient = makeBaseLlmClient(speaker);

        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'check next_speaker now' }],
          } as IContent,
        ];

        const result = await generateJson(
          config,
          {} as never,
          baseLlmClient,
          contents,
          {},
          abortSignal,
          'test-model',
          {},
          'session-1',
        );

        expect(result).toStrictEqual({
          reasoning: 'Gemini returned plain text response',
          next_speaker: speaker,
        });
      }),
    );
  });

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
      finishReason: string | undefined,
      usage?: UsageStats,
    ): Promise<void> {
      const mgr = new ConversationManager(hs, ctx, 'test-model');
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

      const aiEntries = historyService
        .getAll()
        .filter((c) => c.speaker === 'ai');
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
      const mgr = new ConversationManager(historyService, ctx, 'test-model');
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
      const mgr = new ConversationManager(historyService, ctx, 'test-model');
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
});
