/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-009.1, REQ-009.2, REQ-009.3
 * @pseudocode lines 90-92
 *
 * Persisted-history compatibility: pre-change serialized history
 * (JSON without providerMetadata / reasoningTokens / toolTokens fields)
 * must still parse and yield the same ContentValidation verdicts.
 * Blocks WITH providerMetadata must round-trip through JSON unchanged.
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  ContentValidation,
  type IContent,
  type TextBlock,
  type ToolCallBlock,
  type ToolResponseBlock,
  type MediaBlock,
  type ThinkingBlock,
  type CodeBlock,
  type UsageStats,
} from './IContent.js';

// Simulates pre-change serialized history (no providerMetadata on blocks,
// no reasoningTokens/toolTokens on UsageStats).
const PRE_CHANGE_HISTORY: IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Hello' }],
  },
  {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'Hi there' }],
  },
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: '   ' }],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'call-1',
        name: 'search',
        parameters: { q: 'test' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'search',
        result: 'found it',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [{ type: 'text', text: '' }],
  },
];

describe('REQ-009.3: pre-change serialized history compatibility', () => {
  it('parses pre-change JSON without error and preserves content', () => {
    const serialized = JSON.stringify(PRE_CHANGE_HISTORY);
    const parsed: IContent[] = JSON.parse(serialized);

    expect(parsed).toHaveLength(PRE_CHANGE_HISTORY.length);
    expect(parsed[0].blocks[0]).toStrictEqual({ type: 'text', text: 'Hello' });
  });

  it('ContentValidation.hasContent returns same verdicts as before for pre-change history', () => {
    const serialized = JSON.stringify(PRE_CHANGE_HISTORY);
    const parsed: IContent[] = JSON.parse(serialized);

    const expectedVerdicts = [true, true, false, true, true, false];
    for (let i = 0; i < parsed.length; i++) {
      expect(ContentValidation.hasContent(parsed[i])).toBe(expectedVerdicts[i]);
    }
  });

  it('pre-change UsageStats (without reasoningTokens/toolTokens) is still valid', () => {
    const preChangeUsage: UsageStats = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: 10,
    };
    const serialized = JSON.stringify(preChangeUsage);
    const parsed: UsageStats = JSON.parse(serialized);

    expect(parsed.promptTokens).toBe(100);
    expect(parsed.completionTokens).toBe(50);
    expect(parsed.totalTokens).toBe(150);
    expect(parsed.reasoningTokens).toBeUndefined();
    expect(parsed.toolTokens).toBeUndefined();
  });
});

describe('REQ-009.1: block-level providerMetadata round-trip', () => {
  it('TextBlock with providerMetadata round-trips through JSON', () => {
    const block: TextBlock = {
      type: 'text',
      text: 'hello',
      providerMetadata: { gemini: { safetyRating: 'low' } },
    };
    const roundTripped: TextBlock = JSON.parse(JSON.stringify(block));
    expect(roundTripped).toStrictEqual(block);
    expect(roundTripped.providerMetadata).toStrictEqual({
      gemini: { safetyRating: 'low' },
    });
  });

  it('ToolCallBlock with providerMetadata round-trips through JSON', () => {
    const block: ToolCallBlock = {
      type: 'tool_call',
      id: 'call-1',
      name: 'search',
      parameters: { q: 'x' },
      providerMetadata: { gemini: { toolCallId: 'abc' } },
    };
    const roundTripped: ToolCallBlock = JSON.parse(JSON.stringify(block));
    expect(roundTripped).toStrictEqual(block);
  });

  it('ToolResponseBlock with providerMetadata round-trips through JSON', () => {
    const block: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'search',
      result: 'ok',
      providerMetadata: { openai: { toolResultId: 'xyz' } },
    };
    const roundTripped: ToolResponseBlock = JSON.parse(JSON.stringify(block));
    expect(roundTripped).toStrictEqual(block);
  });

  it('MediaBlock with providerMetadata round-trips through JSON', () => {
    const block: MediaBlock = {
      type: 'media',
      mimeType: 'image/png',
      data: 'base64data',
      encoding: 'base64',
      providerMetadata: { gemini: { videoMetadata: { fps: 30 } } },
    };
    const roundTripped: MediaBlock = JSON.parse(JSON.stringify(block));
    expect(roundTripped).toStrictEqual(block);
  });

  it('ThinkingBlock with providerMetadata round-trips through JSON', () => {
    const block: ThinkingBlock = {
      type: 'thinking',
      thought: 'reasoning here',
      providerMetadata: { anthropic: { thinkingSignature: 'sig' } },
    };
    const roundTripped: ThinkingBlock = JSON.parse(JSON.stringify(block));
    expect(roundTripped).toStrictEqual(block);
  });

  it('CodeBlock with providerMetadata round-trips through JSON', () => {
    const block: CodeBlock = {
      type: 'code',
      code: 'print(1)',
      language: 'python',
      providerMetadata: { gemini: { executable: true } },
    };
    const roundTripped: CodeBlock = JSON.parse(JSON.stringify(block));
    expect(roundTripped).toStrictEqual(block);
  });

  it('blocks WITHOUT providerMetadata still parse correctly (backward compat)', () => {
    const block: TextBlock = { type: 'text', text: 'old data' };
    const roundTripped: TextBlock = JSON.parse(JSON.stringify(block));
    expect(roundTripped.providerMetadata).toBeUndefined();
    expect(roundTripped.text).toBe('old data');
  });
});

describe('REQ-009.2: UsageStats new optional fields', () => {
  it('constructs with reasoningTokens and toolTokens', () => {
    const usage: UsageStats = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 200,
      reasoningTokens: 30,
      toolTokens: 20,
    };
    expect(usage.reasoningTokens).toBe(30);
    expect(usage.toolTokens).toBe(20);
  });

  it('constructs without the new fields (backward compat)', () => {
    const usage: UsageStats = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
    expect(usage.reasoningTokens).toBeUndefined();
    expect(usage.toolTokens).toBeUndefined();
  });
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('IContent providerMetadata property-based', () => {
  it.prop([
    fc.record({
      type: fc.constant('text'),
      text: fc.string({ maxLength: 100 }),
      providerMetadata: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ maxLength: 20 }),
      ),
    }),
  ])(
    'any TextBlock with providerMetadata round-trips through JSON unchanged',
    (block: TextBlock) => {
      const roundTripped: TextBlock = JSON.parse(JSON.stringify(block));
      return JSON.stringify(roundTripped) === JSON.stringify(block);
    },
  );

  it.prop([
    fc.array(
      fc.record({
        type: fc.constant('text'),
        text: fc.string({ minLength: 0, maxLength: 20 }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  ])(
    'pre-change history (no providerMetadata) still parses and ContentValidation verdicts are deterministic',
    (blocks) => {
      const content: IContent = {
        speaker: 'human',
        blocks,
      };
      const serialized = JSON.stringify(content);
      const parsed: IContent = JSON.parse(serialized);
      const verdict = ContentValidation.hasContent(parsed);
      const expectedVerdict = blocks.some((b) => b.text.trim().length > 0);
      return verdict === expectedVerdict;
    },
  );

  it.prop([
    fc.record({
      type: fc.constant('tool_call'),
      id: fc.string({ minLength: 1, maxLength: 10 }),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      parameters: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 5 }),
        fc.string({ maxLength: 10 }),
      ),
      providerMetadata: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ maxLength: 20 }),
      ),
    }),
  ])(
    'ToolCallBlock with providerMetadata round-trips through JSON unchanged',
    (block: ToolCallBlock) => {
      const roundTripped: ToolCallBlock = JSON.parse(JSON.stringify(block));
      return JSON.stringify(roundTripped) === JSON.stringify(block);
    },
  );

  it.prop([
    fc.record({
      type: fc.constant('media'),
      mimeType: fc.string({ minLength: 1, maxLength: 20 }),
      data: fc.string({ minLength: 1, maxLength: 30 }),
      encoding: fc.constantFrom('url' as const, 'base64' as const),
      providerMetadata: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ maxLength: 20 }),
      ),
    }),
  ])(
    'MediaBlock with providerMetadata round-trips through JSON unchanged',
    (block: MediaBlock) => {
      const roundTripped: MediaBlock = JSON.parse(JSON.stringify(block));
      return JSON.stringify(roundTripped) === JSON.stringify(block);
    },
  );

  it.prop([
    fc.record({
      promptTokens: fc.nat({ max: 100000 }),
      completionTokens: fc.nat({ max: 100000 }),
      totalTokens: fc.nat({ max: 200000 }),
      reasoningTokens: fc.option(fc.nat({ max: 50000 })),
      toolTokens: fc.option(fc.nat({ max: 50000 })),
    }),
  ])(
    'UsageStats with new fields round-trips through JSON unchanged',
    (stats) => {
      const cleaned: UsageStats = {
        promptTokens: stats.promptTokens,
        completionTokens: stats.completionTokens,
        totalTokens: stats.totalTokens,
      };
      if (stats.reasoningTokens !== null)
        cleaned.reasoningTokens = stats.reasoningTokens;
      if (stats.toolTokens !== null) cleaned.toolTokens = stats.toolTokens;
      const roundTripped: UsageStats = JSON.parse(JSON.stringify(cleaned));
      return JSON.stringify(roundTripped) === JSON.stringify(cleaned);
    },
  );
});
