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
    // media: hasContent checks !!data && !!mimeType → true
    blocks: [
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'base64data',
        encoding: 'base64',
      },
    ],
  },
  {
    speaker: 'ai',
    // thinking with sourceField 'thinking': hasContent checks
    // hasThought && Boolean(signature) → true
    blocks: [
      {
        type: 'thinking',
        thought: 'a thought',
        sourceField: 'thinking',
        signature: 'sig-abc',
      },
    ],
  },
  {
    speaker: 'ai',
    // plain thought (no sourceField): hasContent checks
    // hasThought || hasEncrypted → true
    blocks: [
      {
        type: 'thinking',
        thought: 'plain thought',
      },
    ],
  },
  {
    speaker: 'ai',
    // code: hasContent checks Boolean(code) && code.trim().length > 0 → true
    blocks: [{ type: 'code', code: 'print(1)', language: 'python' }],
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

    // Verdicts derived from ContentValidation.hasContent logic:
    // [0] text 'Hello' → true; [1] text 'Hi there' → true;
    // [2] text '   ' → false (whitespace-only); [3] tool_call → true;
    // [4] tool_response → true;
    // [5] media (data+mimeType present) → true;
    // [6] thinking (sourceField 'thinking' + signature) → true;
    // [7] plain thought (hasThought) → true;
    // [8] code (non-empty code) → true.
    // Each block type is in its own IContent entry so .some() does not
    // short-circuit and mask individual verdicts.
    const expectedVerdicts = [
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
    ];
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
        fc.jsonValue(),
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
    'hasContent verdict is stable across JSON round-trips (no providerMetadata)',
    (blocks) => {
      const content: IContent = {
        speaker: 'human',
        blocks,
      };
      const verdict = ContentValidation.hasContent(content);
      // Round-trip-stability invariant: hasContent must yield the same verdict
      // after a JSON round-trip. This does NOT re-implement the hasContent
      // predicate (which would mirror the implementation under test).
      const roundTrippedVerdict = ContentValidation.hasContent(
        JSON.parse(JSON.stringify(content)),
      );
      return verdict === roundTrippedVerdict;
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
    fc
      .record({
        promptTokens: fc.nat({ max: 100000 }),
        completionTokens: fc.nat({ max: 100000 }),
        totalTokens: fc.nat({ max: 200000 }),
        reasoningTokens: fc.option(fc.nat({ max: 50000 })),
        toolTokens: fc.option(fc.nat({ max: 50000 })),
      })
      .map((v): UsageStats => {
        const stats: UsageStats = {
          promptTokens: v.promptTokens,
          completionTokens: v.completionTokens,
          totalTokens: v.totalTokens,
        };
        if (v.reasoningTokens !== null) {
          stats.reasoningTokens = v.reasoningTokens;
        }
        if (v.toolTokens !== null) {
          stats.toolTokens = v.toolTokens;
        }
        return stats;
      }),
  ])(
    'UsageStats with new fields round-trips through JSON unchanged',
    (stats: UsageStats) => {
      const roundTripped: UsageStats = JSON.parse(JSON.stringify(stats));
      return JSON.stringify(roundTripped) === JSON.stringify(stats);
    },
  );
});
