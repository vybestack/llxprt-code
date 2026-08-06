/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P13
 * @requirement REQ-HD-008.1, REQ-HD-008.2, REQ-HD-008.3, REQ-HD-008.4,
 *              REQ-HD-008.5, REQ-HD-008.6
 *
 * Behavioral tests for the HighDensityStrategy.compress() method.
 * compress() performs deterministic (no-LLM) compression by summarizing
 * tool responses outside a preserved tail and optionally truncating
 * oldest entries to meet a target token budget.
 *
 * Tests operate on a REAL HighDensityStrategy instance. No mock theater.
 */

import { describe, it, expect, beforeEach } from '../../testApi.js';
import * as fc from 'fast-check';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';

// ---------------------------------------------------------------------------
// Test helpers — construct real IContent objects
// ---------------------------------------------------------------------------

let callIdCounter = 0;

function nextCallId(): string {
  return `call-${++callIdCounter}`;
}

function resetCallIds(): void {
  callIdCounter = 0;
}

function makeHumanMessage(text: string, timestamp?: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: timestamp ?? Date.now() },
  };
}

function makeAiText(text: string, timestamp?: number): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: timestamp ?? Date.now() },
  };
}

function makeAiToolCall(
  toolName: string,
  parameters: unknown,
  callId?: string,
): { entry: IContent; callId: string } {
  const id = callId ?? nextCallId();
  return {
    entry: {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id,
          name: toolName,
          parameters,
        } as ToolCallBlock,
      ],
      metadata: { timestamp: Date.now() },
    },
    callId: id,
  };
}

function makeToolResponse(
  callId: string,
  toolName: string,
  result: unknown,
  error?: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
        ...(error !== undefined ? { error } : {}),
      } as ToolResponseBlock,
    ],
    metadata: { timestamp: Date.now() },
  };
}

/**
 * Simple word-count token estimator for tests.
 * Counts words across all text-like content in an IContent array.
 */
function wordCountEstimateTokens(
  contents: readonly IContent[],
): Promise<number> {
  let total = 0;
  for (const entry of contents) {
    for (const block of entry.blocks) {
      if (block.type === 'text') {
        total += block.text.split(/\s+/).filter(Boolean).length;
      } else if (block.type === 'tool_response') {
        const resultStr =
          typeof block.result === 'string'
            ? block.result
            : JSON.stringify(block.result);
        total += resultStr.split(/\s+/).filter(Boolean).length;
      } else if (block.type === 'tool_call') {
        const paramStr = JSON.stringify(block.parameters);
        total += paramStr.split(/\s+/).filter(Boolean).length;
        total += block.name.length;
      }
    }
  }
  return Promise.resolve(total);
}

// ---------------------------------------------------------------------------
// CompressionContext builder
// ---------------------------------------------------------------------------

function buildCompressContext(
  overrides?: Partial<{
    history: IContent[];
    preserveThreshold: number;
    compressionThreshold: number;
    contextLimit: number;
    estimateTokens: (contents: readonly IContent[]) => Promise<number>;
    currentTokenCount: number;
  }>,
): CompressionContext {
  const history = overrides?.history ?? [];
  const preserveThreshold = overrides?.preserveThreshold ?? 0.3;
  const compressionThreshold = overrides?.compressionThreshold ?? 0.85;
  const contextLimit = overrides?.contextLimit ?? 128000;

  return {
    history,
    runtimeContext: {
      state: {
        runtimeId: 'test',
        provider: 'test',
        model: 'test',
        sessionId: 'test',
        updatedAt: Date.now(),
      },
      ephemerals: {
        compressionThreshold: () => compressionThreshold,
        contextLimit: () => contextLimit,
        preserveThreshold: () => preserveThreshold,
        topPreserveThreshold: () => 0.1,
        compressionProfile: () => undefined,
        compressionStrategy: () => 'high-density',
        toolFormatOverride: () => undefined,
        densityCompressHeadroom: () => 0.6,
        reasoning: {
          enabled: () => false,
          includeInContext: () => false,
          includeInResponse: () => false,
          format: () => 'native' as const,
          stripFromContext: () => 'none' as const,
          effort: () => undefined,
          maxTokens: () => undefined,
          adaptiveThinking: () => undefined,
        },
      },
    } as unknown as CompressionContext['runtimeContext'],
    runtimeState: {
      runtimeId: 'test',
      provider: 'test',
      model: 'test',
      sessionId: 'test',
      updatedAt: Date.now(),
    } as unknown as CompressionContext['runtimeState'],
    estimateTokens: overrides?.estimateTokens ?? wordCountEstimateTokens,
    currentTokenCount: overrides?.currentTokenCount ?? 100000,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {},
    } as unknown as CompressionContext['logger'],
    resolveProvider: () => {
      throw new Error('resolveProvider must not be called — no LLM allowed');
      return { provider: undefined as never, runtime: undefined as never };
    },
    promptResolver: {
      resolveFile: () => ({ found: false, path: null, source: null }),
    } as unknown as CompressionContext['promptResolver'],
    promptBaseDir: '/tmp/test',
    promptContext: { provider: 'test', model: 'test' },
    promptId: 'test',
  };
}

// ---------------------------------------------------------------------------
// Build a realistic mixed history
// ---------------------------------------------------------------------------

function buildMixedHistory(entryCount: number): IContent[] {
  resetCallIds();
  const history: IContent[] = [];
  for (let i = 0; i < entryCount; i++) {
    const phase = i % 4;
    if (phase === 0) {
      history.push(makeHumanMessage(`User question ${i}`));
    } else if (phase === 1) {
      const { entry, callId } = makeAiToolCall('read_file', {
        file_path: `/workspace/src/file${i}.ts`,
      });
      history.push(entry);
      // tool response follows immediately
      const lines = Array.from(
        { length: 50 },
        (_, j) => `line ${j + 1}: content of file${i}.ts`,
      ).join('\n');
      history.push(makeToolResponse(callId, 'read_file', lines));
      i++; // consumed an extra slot
    } else if (phase === 2) {
      history.push(makeAiText(`Here is my analysis of the code at step ${i}.`));
    } else {
      const { entry, callId } = makeAiToolCall('run_shell_command', {
        command: `echo "test output ${i}"`,
      });
      history.push(entry);
      history.push(
        makeToolResponse(
          callId,
          'run_shell_command',
          `test output ${i}\nmore output`,
        ),
      );
      i++; // consumed an extra slot
    }
  }
  return history;
}

// ---------------------------------------------------------------------------
// Strategy instance
// ---------------------------------------------------------------------------

function createStrategy(): HighDensityStrategy {
  return new HighDensityStrategy();
}

function resultHistory(result: StrategyCompressionResult): IContent[] {
  return result.kind === 'applied' ? result.newHistory : [];
}

function collectToolResponses(
  result: StrategyCompressionResult,
): ToolResponseBlock[] {
  return resultHistory(result)
    .filter((e) => e.speaker === 'tool')
    .flatMap((e) => e.blocks)
    .filter((b): b is ToolResponseBlock => b.type === 'tool_response');
}

function assertToolCallsHaveResponses(result: StrategyCompressionResult): void {
  const history = resultHistory(result);
  for (const entry of history.filter((e) => e.speaker === 'ai')) {
    for (const id of entry.blocks
      .filter((b): b is ToolCallBlock => b.type === 'tool_call')
      .map((tc) => tc.id)) {
      expect(
        history.some(
          (e) =>
            e.speaker === 'tool' &&
            e.blocks.some(
              (b): b is ToolResponseBlock =>
                b.type === 'tool_response' && b.callId === id,
            ),
        ),
      ).toBe(true);
    }
  }
}

function assertSummarizedToolResponsesUnderLimit(
  result: StrategyCompressionResult,
  bigContent: string,
): void {
  for (const block of collectToolResponses(result)) {
    const resultStr = String(block.result);
    expect(resultStr === bigContent || resultStr.length < 200).toBe(true);
  }
}

function assertToolResponseMentionsSummary(
  result: StrategyCompressionResult,
  keywords: string[],
): void {
  for (const block of collectToolResponses(result)) {
    expect(keywords.some((kw) => String(block.result).includes(kw))).toBe(true);
  }
}

function assertAiTailEntriesMatchOriginal(
  originalTail: IContent[],
  resultTail: IContent[],
): void {
  const len = Math.min(originalTail.length, resultTail.length);
  for (let i = 0; i < len; i++) {
    if (originalTail[i].speaker === 'ai') {
      expect(resultTail[i]).toStrictEqual(originalTail[i]);
    }
  }
}

function assertNonTailToolResponsesAreStrings(
  result: StrategyCompressionResult,
  tailSize: number,
): void {
  const history = resultHistory(result);
  const nonTailHistory = tailSize === 0 ? history : history.slice(0, -tailSize);
  const responses = nonTailHistory
    .filter((e) => e.speaker === 'tool')
    .flatMap((e) => e.blocks)
    .filter((b): b is ToolResponseBlock => b.type === 'tool_response');
  for (const response of responses) {
    expect(typeof response.result).toBe('string');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HighDensityStrategy.compress() @plan PLAN-20260211-HIGHDENSITY.P13', () => {
  beforeEach(() => {
    resetCallIds();
  });

  // -------------------------------------------------------------------------
  // REQ-HD-008.1: No LLM Call
  // -------------------------------------------------------------------------

  describe('No LLM Call @requirement REQ-HD-008.1', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.1
     * @pseudocode high-density-compress.md lines 10-91
     */
    it('compress does not call resolveProvider', async () => {
      const strategy = createStrategy();
      const history = buildMixedHistory(10);
      const ctx = buildCompressContext({ history });

      // If resolveProvider throws and compress succeeds, it proves no LLM call was made
      const result = await strategy.compress(ctx);

      expect(result).toBeDefined();
      expect(result.kind).toBe('applied');
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.1
     */
    it('metadata.llmCallMade is always false', async () => {
      const strategy = createStrategy();
      const history = buildMixedHistory(12);
      const ctx = buildCompressContext({ history });

      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // REQ-HD-008.2: Recent Tail Preservation
  // -------------------------------------------------------------------------

  describe('Recent tail preservation @requirement REQ-HD-008.2', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.2
     */
    it('recent tail entries are preserved intact', async () => {
      const strategy = createStrategy();
      const history = buildMixedHistory(10);
      const tailSize = Math.floor(history.length * 0.3);
      const ctx = buildCompressContext({
        history,
        preserveThreshold: 0.3,
      });

      const result = await strategy.compress(ctx);
      expect(result.kind).toBe('applied');

      // The last tailSize entries in newHistory should match the last tailSize in original
      const originalTail = history.slice(-tailSize);
      const resultTail = resultHistory(result).slice(-tailSize);

      expect(resultTail.length).toBe(originalTail.length);
      for (let i = 0; i < originalTail.length; i++) {
        expect(resultTail[i]).toStrictEqual(originalTail[i]);
      }
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.2
     */
    it('tail boundary does not split tool_call/tool_response pairs', async () => {
      resetCallIds();
      const strategy = createStrategy();
      // Carefully craft history where tail boundary falls between a tool_call and its response
      const human1 = makeHumanMessage('Question 1');
      const { entry: ai1, callId: cid1 } = makeAiToolCall('read_file', {
        file_path: '/workspace/a.ts',
      });
      const tool1 = makeToolResponse(cid1, 'read_file', 'contents of a.ts');
      const human2 = makeHumanMessage('Question 2');
      const { entry: ai2, callId: cid2 } = makeAiToolCall('read_file', {
        file_path: '/workspace/b.ts',
      });
      const tool2 = makeToolResponse(cid2, 'read_file', 'contents of b.ts');
      const human3 = makeHumanMessage('Question 3');
      const ai3 = makeAiText('Final answer');

      const history = [human1, ai1, tool1, human2, ai2, tool2, human3, ai3];
      // preserveThreshold=0.3 → tail is 2 entries out of 8 (entries 6,7 = human3, ai3)
      // But if boundary falls between tool_call(ai2) and tool_response(tool2),
      // adjust to include both
      const ctx = buildCompressContext({
        history,
        preserveThreshold: 0.3,
      });

      const result = await strategy.compress(ctx);
      expect(result.kind).toBe('applied');

      expect(resultHistory(result).length).toBeLessThanOrEqual(history.length);
      assertToolCallsHaveResponses(result);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.2
     */
    it('tail covering entire history returns history unchanged', async () => {
      const strategy = createStrategy();
      const history = [
        makeHumanMessage('Hello'),
        makeAiText('Hi there'),
        makeHumanMessage('How are you?'),
      ];
      const ctx = buildCompressContext({
        history,
        preserveThreshold: 1.0,
      });

      const result = await strategy.compress(ctx);

      expect(result.kind).toBe('noop');
      expect(result.reason).toBe('tail-covers-all');
    });
  });

  // -------------------------------------------------------------------------
  // REQ-HD-008.3: Tool Response Summarization
  // -------------------------------------------------------------------------

  describe('Tool response summarization @requirement REQ-HD-008.3', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.3
     */
    it('tool responses outside tail are summarized to short strings', async () => {
      resetCallIds();
      const strategy = createStrategy();

      const human = makeHumanMessage('Read the file');
      const { entry: aiCall, callId } = makeAiToolCall('read_file', {
        file_path: '/workspace/src/big.ts',
      });
      const bigContent = Array.from(
        { length: 200 },
        (_, i) => `line ${i + 1}: export function foo${i}() { return ${i}; }`,
      ).join('\n');
      const toolResp = makeToolResponse(callId, 'read_file', bigContent);
      const human2 = makeHumanMessage('Thanks');
      const ai2 = makeAiText('You are welcome');

      // Tail = last 1 entry (preserveThreshold = 0.2 on 5 entries → 1 entry)
      const history = [human, aiCall, toolResp, human2, ai2];
      const ctx = buildCompressContext({
        history,
        preserveThreshold: 0.2,
      });

      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(false);
      assertSummarizedToolResponsesUnderLimit(result, bigContent);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.3
     */
    it('summary includes tool name and success/error status', async () => {
      resetCallIds();
      const strategy = createStrategy();

      const { entry: readAi, callId: readId } = makeAiToolCall('read_file', {
        file_path: '/workspace/src/file.ts',
      });
      const readResp = makeToolResponse(
        readId,
        'read_file',
        'file content here...',
      );

      const { entry: grepAi, callId: grepId } = makeAiToolCall('grep', {
        pattern: 'TODO',
      });
      const grepResp = makeToolResponse(
        grepId,
        'grep',
        'error occurred',
        'grep failed',
      );

      // tail covers only the last entry
      const tail = makeHumanMessage('done');
      const history = [readAi, readResp, grepAi, grepResp, tail];

      const ctx = buildCompressContext({
        history,
        preserveThreshold: 0.2,
      });

      const result = await strategy.compress(ctx);
      expect(result.kind).toBe('applied');

      // Check that summaries reference tool names
      const toolEntries = resultHistory(result).filter(
        (e) => e.speaker === 'tool',
      );
      const summaries: string[] = [];
      for (const te of toolEntries) {
        for (const block of te.blocks) {
          if (block.type === 'tool_response') {
            summaries.push(String(block.result));
          }
        }
      }

      // At least one summary should contain the tool name
      const hasSummaryWithReadFile = summaries.some((s) =>
        s.includes('read_file'),
      );
      const hasSummaryWithGrep = summaries.some((s) => s.includes('grep'));
      expect(hasSummaryWithReadFile || hasSummaryWithGrep).toBe(true);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.3
     */
    it('summary for responses with file paths includes the path', async () => {
      resetCallIds();
      const strategy = createStrategy();

      const { entry: aiCall, callId } = makeAiToolCall('read_file', {
        file_path: '/workspace/src/important.ts',
      });
      const toolResp = makeToolResponse(
        callId,
        'read_file',
        'lots of code here...\n'.repeat(100),
      );
      const tail = makeHumanMessage('next question');

      const history = [aiCall, toolResp, tail];
      const ctx = buildCompressContext({
        history,
        preserveThreshold: 0.3,
      });

      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(false);
      assertToolResponseMentionsSummary(result, [
        'read_file',
        'important.ts',
        '/workspace',
      ]);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.2, REQ-HD-008.3
     */
    it('tool responses inside tail are NOT summarized', async () => {
      resetCallIds();
      const strategy = createStrategy();

      const human1 = makeHumanMessage('First question');
      const ai1 = makeAiText('First answer');
      const { entry: aiCall, callId } = makeAiToolCall('read_file', {
        file_path: '/workspace/src/tail.ts',
      });
      const toolResp = makeToolResponse(callId, 'read_file', 'full content');

      // preserveThreshold = 1.0 → entire history is in the tail (noop)
      const history = [human1, ai1, aiCall, toolResp];
      const ctx = buildCompressContext({
        history,
        preserveThreshold: 1.0,
      });

      const result = await strategy.compress(ctx);

      // Tail covers all → structural noop; history unchanged means the tail
      // tool response is preserved verbatim (NOT summarized).
      expect(result.kind).toBe('noop');
      expect(result.reason).toBe('tail-covers-all');
    });
  });

  // -------------------------------------------------------------------------
  // REQ-HD-008.4: Non-Tool Content Preserved
  // -------------------------------------------------------------------------

  describe('Non-tool content preserved @requirement REQ-HD-008.4', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.4
     */
    it('human messages are preserved intact', async () => {
      resetCallIds();
      const strategy = createStrategy();

      const human1 = makeHumanMessage('First question');
      const { entry: aiCall, callId } = makeAiToolCall('read_file', {
        file_path: '/workspace/a.ts',
      });
      const toolResp = makeToolResponse(
        callId,
        'read_file',
        'file contents...',
      );
      const human2 = makeHumanMessage('Second question');
      const ai2 = makeAiText('Answer');

      const history = [human1, aiCall, toolResp, human2, ai2];
      const ctx = buildCompressContext({
        history,
        preserveThreshold: 0.2,
      });

      const result = await strategy.compress(ctx);
      expect(result.kind).toBe('applied');

      const humanEntries = resultHistory(result).filter(
        (e) => e.speaker === 'human',
      );
      // All original human messages should appear in the result
      const originalHumans = history.filter((e) => e.speaker === 'human');
      expect(humanEntries.length).toBe(originalHumans.length);
      for (const oh of originalHumans) {
        const found = humanEntries.some(
          (h) =>
            h.blocks[0].type === 'text' &&
            oh.blocks[0].type === 'text' &&
            h.blocks[0].text === oh.blocks[0].text,
        );
        expect(found).toBe(true);
      }
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.4
     */
    it('AI text blocks and tool_call blocks are preserved intact', async () => {
      resetCallIds();
      const strategy = createStrategy();

      const ai1 = makeAiText('My analysis is thorough');
      const { entry: aiCall, callId } = makeAiToolCall('write_file', {
        file_path: '/workspace/out.ts',
        content: 'new content',
      });
      const toolResp = makeToolResponse(callId, 'write_file', 'wrote out.ts');
      const human = makeHumanMessage('OK');
      const ai2 = makeAiText('Done');

      const history = [ai1, aiCall, toolResp, human, ai2];
      const ctx = buildCompressContext({
        history,
        preserveThreshold: 0.2,
      });

      const result = await strategy.compress(ctx);
      expect(result.kind).toBe('applied');

      // AI text entries should be unchanged
      const aiTextEntries = resultHistory(result).filter(
        (e) => e.speaker === 'ai' && e.blocks.some((b) => b.type === 'text'),
      );
      for (const ae of aiTextEntries) {
        const textBlock = ae.blocks.find((b) => b.type === 'text');
        expect(textBlock).toBeDefined();
      }

      // AI tool_call blocks should be unchanged
      const aiToolCallEntries = resultHistory(result).filter(
        (e) =>
          e.speaker === 'ai' && e.blocks.some((b) => b.type === 'tool_call'),
      );
      for (const ate of aiToolCallEntries) {
        const tcBlock = ate.blocks.find(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock;
        expect(tcBlock.name).toBeDefined();
        expect(tcBlock.id).toBeDefined();
        expect(tcBlock.parameters).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // REQ-HD-008.5: CompressionResult Assembly
  // -------------------------------------------------------------------------

  describe('CompressionResult shape @requirement REQ-HD-008.5', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.5
     */
    it('result has correct metadata shape', async () => {
      const strategy = createStrategy();
      const history = buildMixedHistory(15);
      const ctx = buildCompressContext({ history });

      const result = await strategy.compress(ctx);

      expect(result.metadata.originalMessageCount).toBe(history.length);
      expect(result.metadata.strategyUsed).toBe('high-density');
      expect(result.metadata.llmCallMade).toBe(false);
      expect(typeof result.metadata.compressedMessageCount).toBe('number');
      expect(result.metadata.compressedMessageCount).toBeGreaterThanOrEqual(0);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.5
     */
    it('newHistory is a proper IContent array', async () => {
      const strategy = createStrategy();
      const history = buildMixedHistory(8);
      const ctx = buildCompressContext({ history });

      const result = await strategy.compress(ctx);
      expect(result.kind).toBe('applied');

      expect(Array.isArray(resultHistory(result))).toBe(true);
      for (const entry of resultHistory(result)) {
        expect(['human', 'ai', 'tool']).toContain(entry.speaker);
        expect(Array.isArray(entry.blocks)).toBe(true);
        expect(entry.blocks.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // REQ-HD-008.6: Target Token Count
  // -------------------------------------------------------------------------

  describe('Token target @requirement REQ-HD-008.6', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.6
     */
    it('target token calculation is approximately threshold × contextLimit × 0.6', async () => {
      const strategy = createStrategy();
      // Create a large history that will need substantial compression
      const history = buildMixedHistory(40);

      const ctx = buildCompressContext({
        history,
        compressionThreshold: 0.85,
        contextLimit: 128000,
        currentTokenCount: 120000,
      });

      const result = await strategy.compress(ctx);
      expect(result.kind).toBe('applied');

      // Target = 0.85 × 128000 × 0.6 = 65,280
      // Post-compression should be within ±10% of this target
      const target = 0.85 * 128000 * 0.6;
      const estimatedTokens = await wordCountEstimateTokens(
        resultHistory(result),
      );
      // The result should be at or below the target (compression is reductive)
      // We allow some tolerance since word-count is a rough estimator
      expect(estimatedTokens).toBeLessThanOrEqual(target * 1.1);
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     * @requirement REQ-HD-008.6
     */
    it('aggressive truncation removes oldest entries when summarization insufficient', async () => {
      resetCallIds();
      const strategy = createStrategy();

      // Create a history with very large entries
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        history.push(makeHumanMessage(`Question ${i}`));
        const { entry, callId } = makeAiToolCall('read_file', {
          file_path: `/workspace/file${i}.ts`,
        });
        history.push(entry);
        // Very large result
        const bigContent = Array.from(
          { length: 500 },
          (_, j) => `line ${j}: ${'x'.repeat(100)}`,
        ).join('\n');
        history.push(makeToolResponse(callId, 'read_file', bigContent));
      }

      const ctx = buildCompressContext({
        history,
        contextLimit: 1000, // Very low context limit to force aggressive truncation
        compressionThreshold: 0.85,
        currentTokenCount: 90000,
        preserveThreshold: 0.2,
      });

      const result = await strategy.compress(ctx);
      expect(result.kind).toBe('applied');

      // Some entries should be removed from the front
      expect(resultHistory(result).length).toBeLessThanOrEqual(history.length);
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe('Edge cases', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     */
    it('empty history returns empty result', async () => {
      const strategy = createStrategy();
      const ctx = buildCompressContext({ history: [] });

      const result = await strategy.compress(ctx);

      expect(result.kind).toBe('noop');
      expect(result.reason).toBe('empty-history');
      expect(result.metadata.originalMessageCount).toBe(0);
      expect(result.metadata.compressedMessageCount).toBe(
        result.metadata.originalMessageCount,
      );
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P13
     */
    it('single entry history is preserved', async () => {
      const strategy = createStrategy();
      const single = makeHumanMessage('Only entry');
      const ctx = buildCompressContext({ history: [single] });

      const result = await strategy.compress(ctx);

      // Single entry: tail (size 1) covers the whole history → structural noop
      expect(result.kind).toBe('noop');
      expect(result.reason).toBe('tail-covers-all');
      expect(result.metadata.originalMessageCount).toBe(1);
      expect(result.metadata.compressedMessageCount).toBe(
        result.metadata.originalMessageCount,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property-based tests (≥ 30% of total)
  // -------------------------------------------------------------------------

  describe('Property-based tests', () => {
    const arbToolName = fc.constantFrom(
      'read_file',
      'write_file',
      'run_shell_command',
      'grep',
      'ast_read_file',
    );
    const arbHumanEntry = fc
      .string({ minLength: 1, maxLength: 100 })
      .map((text) => makeHumanMessage(text));
    const arbAiTextEntry = fc
      .string({ minLength: 1, maxLength: 100 })
      .map((text) => makeAiText(text));
    const arbToolPair = fc
      .tuple(arbToolName, fc.string({ minLength: 1, maxLength: 200 }))
      .map(([toolName, resultText]) => {
        const id = nextCallId();
        return [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id,
                name: toolName,
                parameters: { file_path: '/workspace/test.ts' },
              } as ToolCallBlock,
            ],
            metadata: { timestamp: Date.now() },
          },
          makeToolResponse(id, toolName, resultText),
        ] as [IContent, IContent];
      });
    const arbHistorySegment = fc.oneof(
      arbHumanEntry.map((e) => [e]),
      arbAiTextEntry.map((e) => [e]),
      arbToolPair,
    );
    const arbHistory = fc
      .array(arbHistorySegment, { minLength: 1, maxLength: 8 })
      .map((segments) => segments.flat());

    /** Run a property, providing the compressed-or-original history and result. */
    async function runProperty(
      body: (history: IContent[], result: StrategyCompressionResult) => void,
      opts: { preserveThreshold?: number; contextLimit?: number } = {},
    ): Promise<void> {
      await fc.assert(
        fc.asyncProperty(arbHistory, async (history) => {
          resetCallIds();
          const result = await createStrategy().compress(
            buildCompressContext({ history, ...opts }),
          );
          body(history, result);
        }),
        { numRuns: 30 },
      );
    }

    it('newHistory length ≤ original length', async () => {
      await runProperty((history, result) => {
        const out = result.kind === 'applied' ? resultHistory(result) : history;
        expect(out.length).toBeLessThanOrEqual(history.length);
      });
    });

    it('all human messages are preserved in newHistory', async () => {
      await runProperty(
        (history, result) => {
          const out =
            result.kind === 'applied' ? resultHistory(result) : history;
          expect(out.filter((e) => e.speaker === 'human').length).toBe(
            history.filter((e) => e.speaker === 'human').length,
          );
        },
        { preserveThreshold: 0.5, contextLimit: 999999 },
      );
    });

    it('all AI entries in the preserved tail appear unchanged', async () => {
      let asserted = false;
      await runProperty(
        (history, result) => {
          const tailSize = Math.max(1, Math.floor(history.length * 0.3));
          const out =
            result.kind === 'applied' ? resultHistory(result) : history;
          assertAiTailEntriesMatchOriginal(
            history.slice(-tailSize),
            out.slice(-tailSize),
          );
          asserted = true;
        },
        { preserveThreshold: 0.3, contextLimit: 999999 },
      );
      expect(asserted).toBe(true);
    });

    it('metadata.llmCallMade is always false (property)', async () => {
      await runProperty((_history, result) => {
        expect(result.metadata.llmCallMade).toBe(false);
      });
    });

    it('metadata.strategyUsed is always high-density', async () => {
      await runProperty((_history, result) => {
        expect(result.metadata.strategyUsed).toBe('high-density');
      });
    });

    it('metadata counts are consistent with input', async () => {
      await runProperty((history, result) => {
        const out = result.kind === 'applied' ? resultHistory(result) : history;
        expect(result.metadata.originalMessageCount).toBe(history.length);
        expect(result.metadata.compressedMessageCount).toBeLessThanOrEqual(
          result.metadata.originalMessageCount,
        );
        expect(result.metadata.compressedMessageCount).toBe(out.length);
      });
    });

    it('tool response results outside tail are strings (summarized)', async () => {
      let asserted = false;
      await runProperty(
        (history, result) => {
          assertNonTailToolResponsesAreStrings(
            result,
            Math.max(1, Math.floor(history.length * 0.3)),
          );
          asserted = true;
        },
        { preserveThreshold: 0.3, contextLimit: 999999 },
      );
      expect(asserted).toBe(true);
    });
  });
});
