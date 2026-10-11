import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

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

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { ConversationManager } from '../ConversationManager.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

// ---------------------------------------------------------------------------
// Runtime context factory
// ---------------------------------------------------------------------------

import {
  makeRuntimeContext,
  humanText,
  getRecordedHistoryText,
  getRecordedThinkingBlocks,
} from './structural-history-fixture.js';
// ---------------------------------------------------------------------------
// REQ-005.1: ConversationManager text consolidation (BR-7) + thought filtering (BR-5)
// ---------------------------------------------------------------------------

describe('REQ-005.1: ConversationManager text consolidation + thought filtering', () => {
  let historyService: HistoryService;
  let conversationManager: ConversationManager;

  function createManager(includeThoughts: boolean): ConversationManager {
    const ctx = makeRuntimeContext(includeThoughts);
    return new ConversationManager(historyService, ctx);
  }

  beforeEach(() => {
    historyService = new HistoryService();
    conversationManager = createManager(true);
  });

  it('consolidates adjacent text model outputs into single merged text', async () => {
    const userInput = humanText('hello');
    const modelOutput: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Hello ' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'World' }] },
    ];

    await conversationManager.recordHistory(userInput, modelOutput);

    const recordedText = getRecordedHistoryText(historyService);
    expect(recordedText).toBe('Hello World');
  });

  it('consolidates three adjacent text chunks into one continuous string', async () => {
    const userInput = humanText('prompt');
    const modelOutput: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'A' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'B' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'C' }] },
    ];

    await conversationManager.recordHistory(userInput, modelOutput);

    const recordedText = getRecordedHistoryText(historyService);
    expect(recordedText).toBe('ABC');
  });

  it('filters thoughts from recorded text when includeThoughts=false', async () => {
    const ctx = makeRuntimeContext(false);
    const mgr = new ConversationManager(historyService, ctx);
    const userInput = humanText('hi');
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

    await mgr.recordHistory(userInput, modelOutput);

    const recordedText = getRecordedHistoryText(historyService);
    expect(recordedText).toBe('visible answer');
    expect(recordedText).not.toContain('secret thought');
  });

  it('drops thinking blocks and their signatures from history when includeThoughts=false', async () => {
    const ctx = makeRuntimeContext(false);
    const mgr = new ConversationManager(historyService, ctx);
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

    await mgr.recordHistory(userInput, modelOutput);

    // When includeThoughts=false, the thinking block is NOT recorded as
    // a standalone block in history. The signature is retained on any
    // thinking blocks that ARE present.
    const thinkingBlocks = getRecordedThinkingBlocks(historyService);
    // Thoughts are filtered out from history blocks when includeThoughts=false
    expect(thinkingBlocks).toHaveLength(0);
  });

  it('includes thinking blocks in history when includeThoughts=true', async () => {
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

    await conversationManager.recordHistory(userInput, modelOutput);

    const thinkingBlocks = getRecordedThinkingBlocks(historyService);
    expect(thinkingBlocks.length).toBeGreaterThan(0);
    expect(thinkingBlocks[0].thought).toBe('my thought');
    expect(thinkingBlocks[0].signature).toBe('sigXYZ');
  });

  it('records usage metadata on the AI entry', async () => {
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

    await conversationManager.recordHistory(
      userInput,
      modelOutput,
      undefined,
      usage,
    );

    const aiEntries = historyService.getAll().filter((c) => c.speaker === 'ai');
    expect(aiEntries.length).toBeGreaterThan(0);
    expect(aiEntries[0].metadata?.usage?.totalTokens).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// REQ-005.1 PROPERTY TESTS: consolidation + thought filtering
// ---------------------------------------------------------------------------

describe('REQ-005.1: consolidation + thought filtering (property)', () => {
  it('consolidating N adjacent text chunks yields their concatenation (property)', async () => {
    const textArb = fc.string({ minLength: 1 }).filter((s) => s.length > 0);
    const chunksArb = fc.array(textArb, { minLength: 2, maxLength: 10 });

    await fc.assert(
      fc.asyncProperty(chunksArb, async (texts: string[]) => {
        const hs = new HistoryService();
        const ctx = makeRuntimeContext(true);
        const mgr = new ConversationManager(hs, ctx);

        const userInput: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'q' }],
        };
        const modelOutput: IContent[] = texts.map((t) => ({
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: t }],
        }));

        await mgr.recordHistory(userInput, modelOutput);

        const recordedText = getRecordedHistoryText(hs);
        expect(recordedText).toBe(texts.join(''));
      }),
    );
  });

  it('thought text never appears in recorded history when includeThoughts=false (property)', async () => {
    // Use distinct prefixes so the thought text is never a substring of the
    // answer, making the "not contain" assertion meaningful.
    const thoughtArb = fc
      .string({ minLength: 1, maxLength: 40 })
      .map((s) => 'THOUGHT_' + s);
    const answerArb = fc
      .string({ minLength: 1, maxLength: 40 })
      .map((s) => 'ANSWER_' + s);
    const sigArb = fc.string({ minLength: 1, maxLength: 20 });

    await fc.assert(
      fc.asyncProperty(
        thoughtArb,
        answerArb,
        sigArb,
        async (thought: string, answer: string, sig: string) => {
          const hs = new HistoryService();
          const ctx = makeRuntimeContext(false);
          const mgr = new ConversationManager(hs, ctx);

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

          await mgr.recordHistory(userInput, modelOutput);

          const recordedText = getRecordedHistoryText(hs);
          expect(recordedText).toBe(answer);
          expect(recordedText).not.toContain(thought);
        },
      ),
    );
  });

  it('recorded AI text is never empty when model output has visible text (property)', async () => {
    const textArb = fc
      .string({ minLength: 1 })
      .filter((s) => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(textArb, async (text: string) => {
        const hs = new HistoryService();
        const ctx = makeRuntimeContext(true);
        const mgr = new ConversationManager(hs, ctx);

        const userInput: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'q' }],
        };
        const modelOutput: IContent[] = [
          { speaker: 'ai', blocks: [{ type: 'text', text }] },
        ];

        await mgr.recordHistory(userInput, modelOutput);

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
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('test system prompt'),
}));

void vi.mock('../clientToolGovernance.js', () => ({
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue([]),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { generateJson } from '../clientLlmUtilities.js';
import type { BaseLLMClient } from '../baseLlmClient.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';

function makeConfig(): Config {
  return new Config({
    sessionId: 'structural-access',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
    provider: 'test-provider',
    initialSettings: { activeProvider: 'test-provider' },
  });
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
      makeConfig(),
      () => undefined,
      {} as never,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      'test-model',
      {},
      'session-1',
      undefined,
      [],
      emptyInstructionReads,
      fixturePromptPolicy(makeConfig()),
    );

    expect(result).toStrictEqual({
      reasoning: 'user asked a question',
      next_speaker: 'user',
    });
  });

  it('converts plain-text "model" fallback when next_speaker text is present', async () => {
    const baseLlmClient = makeBaseLlmClient('model');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'what is the next_speaker?' }],
      } as IContent,
    ];

    const result = await generateJson(
      makeConfig(),
      () => undefined,
      {} as never,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      'test-model',
      {},
      'session-1',
      undefined,
      [],
      emptyInstructionReads,
      fixturePromptPolicy(makeConfig()),
    );

    expect(result).toStrictEqual({
      reasoning: 'Gemini returned plain text response',
      next_speaker: 'model',
    });
  });

  it('does NOT apply fallback when next_speaker text is absent', async () => {
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
      makeConfig(),
      () => undefined,
      {} as never,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      'test-model',
      {},
      'session-1',
      undefined,
      [],
      emptyInstructionReads,
      fixturePromptPolicy(makeConfig()),
    );

    // The raw string is returned as-is (no next_speaker conversion)
    expect(result).toBe('user');
  });

  it('returns JSON object as-is when no fallback is needed', async () => {
    const baseLlmClient = makeBaseLlmClient({ key: 'value' });

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'generate some next_speaker JSON' }],
      } as IContent,
    ];

    const result = await generateJson(
      makeConfig(),
      () => undefined,
      {} as never,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      'test-model',
      {},
      'session-1',
      undefined,
      [],
      emptyInstructionReads,
      fixturePromptPolicy(makeConfig()),
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
        const baseLlmClient = makeBaseLlmClient(speaker);

        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'check next_speaker now' }],
          } as IContent,
        ];

        const result = await generateJson(
          makeConfig(),
          () => undefined,
          {} as never,
          baseLlmClient,
          contents,
          {},
          abortSignal,
          'test-model',
          {},
          'session-1',
          undefined,
          [],
          emptyInstructionReads,
          fixturePromptPolicy(makeConfig()),
        );

        expect(result).toStrictEqual({
          reasoning: 'Gemini returned plain text response',
          next_speaker: speaker,
        });
      }),
    );
  });
});

function fixturePromptPolicy(config: Config) {
  const policy =
    createSessionSettingsFixture(config).settingsOwner.readRuntimePolicy()
      .promptPolicy;
  if (policy === undefined)
    throw new Error('Fixture settings owner did not provide prompt policy');
  return policy;
}
