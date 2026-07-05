/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4, REQ-001.5
 * @pseudocode lines 10-26
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  mapGeminiFinishReason,
  mapOpenAIFinishReason,
  mapAnthropicStopReason,
  isCanonicalFinishReason,
  GEMINI_FINISH_MAP,
  OPENAI_FINISH_MAP,
  ANTHROPIC_STOP_MAP,
  CANONICAL_FINISH_REASONS,
  type CanonicalFinishReason,
} from './finishReasons.js';

const ALL_CANONICAL = CANONICAL_FINISH_REASONS;

const CANONICAL_STRINGS: readonly string[] = ALL_CANONICAL;

describe('mapGeminiFinishReason', () => {
  it('maps STOP to stop', () => {
    expect(mapGeminiFinishReason('STOP')).toStrictEqual({
      finishReason: 'stop',
      rawStopReason: 'STOP',
    });
  });

  it('maps MAX_TOKENS to max_tokens', () => {
    expect(mapGeminiFinishReason('MAX_TOKENS')).toStrictEqual({
      finishReason: 'max_tokens',
      rawStopReason: 'MAX_TOKENS',
    });
  });

  it('maps SAFETY to safety', () => {
    expect(mapGeminiFinishReason('SAFETY')).toStrictEqual({
      finishReason: 'safety',
      rawStopReason: 'SAFETY',
    });
  });

  it('maps RECITATION to safety', () => {
    expect(mapGeminiFinishReason('RECITATION')).toStrictEqual({
      finishReason: 'safety',
      rawStopReason: 'RECITATION',
    });
  });

  it('maps LANGUAGE to other', () => {
    expect(mapGeminiFinishReason('LANGUAGE')).toStrictEqual({
      finishReason: 'other',
      rawStopReason: 'LANGUAGE',
    });
  });

  it('maps BLOCKLIST to safety', () => {
    expect(mapGeminiFinishReason('BLOCKLIST')).toStrictEqual({
      finishReason: 'safety',
      rawStopReason: 'BLOCKLIST',
    });
  });

  it('maps PROHIBITED_CONTENT to safety', () => {
    expect(mapGeminiFinishReason('PROHIBITED_CONTENT')).toStrictEqual({
      finishReason: 'safety',
      rawStopReason: 'PROHIBITED_CONTENT',
    });
  });

  it('maps SPII to safety', () => {
    expect(mapGeminiFinishReason('SPII')).toStrictEqual({
      finishReason: 'safety',
      rawStopReason: 'SPII',
    });
  });

  it('maps MALFORMED_FUNCTION_CALL to error', () => {
    expect(mapGeminiFinishReason('MALFORMED_FUNCTION_CALL')).toStrictEqual({
      finishReason: 'error',
      rawStopReason: 'MALFORMED_FUNCTION_CALL',
    });
  });

  it('maps OTHER to other', () => {
    expect(mapGeminiFinishReason('OTHER')).toStrictEqual({
      finishReason: 'other',
      rawStopReason: 'OTHER',
    });
  });

  it('maps IMAGE_SAFETY to safety', () => {
    expect(mapGeminiFinishReason('IMAGE_SAFETY')).toStrictEqual({
      finishReason: 'safety',
      rawStopReason: 'IMAGE_SAFETY',
    });
  });

  it('maps IMAGE_PROHIBITED_CONTENT to safety', () => {
    expect(mapGeminiFinishReason('IMAGE_PROHIBITED_CONTENT')).toStrictEqual({
      finishReason: 'safety',
      rawStopReason: 'IMAGE_PROHIBITED_CONTENT',
    });
  });

  it('maps NO_IMAGE to other', () => {
    expect(mapGeminiFinishReason('NO_IMAGE')).toStrictEqual({
      finishReason: 'other',
      rawStopReason: 'NO_IMAGE',
    });
  });

  it('maps UNEXPECTED_TOOL_CALL to error', () => {
    expect(mapGeminiFinishReason('UNEXPECTED_TOOL_CALL')).toStrictEqual({
      finishReason: 'error',
      rawStopReason: 'UNEXPECTED_TOOL_CALL',
    });
  });

  it('maps FINISH_REASON_UNSPECIFIED to other', () => {
    expect(mapGeminiFinishReason('FINISH_REASON_UNSPECIFIED')).toStrictEqual({
      finishReason: 'other',
      rawStopReason: 'FINISH_REASON_UNSPECIFIED',
    });
  });

  it('falls back to other for unrecognized strings', () => {
    expect(mapGeminiFinishReason('SOMETHING_NEW')).toStrictEqual({
      finishReason: 'other',
      rawStopReason: 'SOMETHING_NEW',
    });
  });

  it('empty string maps to other with empty rawStopReason (nullish guard)', () => {
    expect(mapGeminiFinishReason('')).toStrictEqual({
      finishReason: 'other',
      rawStopReason: '',
    });
  });
});

describe('mapOpenAIFinishReason', () => {
  it('maps stop to stop', () => {
    expect(mapOpenAIFinishReason('stop')).toStrictEqual({
      finishReason: 'stop',
      rawStopReason: 'stop',
    });
  });

  it('maps length to max_tokens', () => {
    expect(mapOpenAIFinishReason('length')).toStrictEqual({
      finishReason: 'max_tokens',
      rawStopReason: 'length',
    });
  });

  it('maps tool_calls to tool_calls', () => {
    expect(mapOpenAIFinishReason('tool_calls')).toStrictEqual({
      finishReason: 'tool_calls',
      rawStopReason: 'tool_calls',
    });
  });

  it('maps function_call to tool_calls', () => {
    expect(mapOpenAIFinishReason('function_call')).toStrictEqual({
      finishReason: 'tool_calls',
      rawStopReason: 'function_call',
    });
  });

  it('maps content_filter to safety', () => {
    expect(mapOpenAIFinishReason('content_filter')).toStrictEqual({
      finishReason: 'safety',
      rawStopReason: 'content_filter',
    });
  });

  it('maps refusal to refusal', () => {
    expect(mapOpenAIFinishReason('refusal')).toStrictEqual({
      finishReason: 'refusal',
      rawStopReason: 'refusal',
    });
  });

  it('falls back to other for unrecognized strings', () => {
    expect(mapOpenAIFinishReason('whatever')).toStrictEqual({
      finishReason: 'other',
      rawStopReason: 'whatever',
    });
  });
});

describe('mapAnthropicStopReason', () => {
  it('maps end_turn to stop', () => {
    expect(mapAnthropicStopReason('end_turn')).toStrictEqual({
      finishReason: 'stop',
      rawStopReason: 'end_turn',
    });
  });

  it('maps max_tokens to max_tokens', () => {
    expect(mapAnthropicStopReason('max_tokens')).toStrictEqual({
      finishReason: 'max_tokens',
      rawStopReason: 'max_tokens',
    });
  });

  it('maps tool_use to tool_calls', () => {
    expect(mapAnthropicStopReason('tool_use')).toStrictEqual({
      finishReason: 'tool_calls',
      rawStopReason: 'tool_use',
    });
  });

  it('maps refusal to refusal', () => {
    expect(mapAnthropicStopReason('refusal')).toStrictEqual({
      finishReason: 'refusal',
      rawStopReason: 'refusal',
    });
  });

  it('maps stop_sequence to stop', () => {
    expect(mapAnthropicStopReason('stop_sequence')).toStrictEqual({
      finishReason: 'stop',
      rawStopReason: 'stop_sequence',
    });
  });

  it('falls back to other for unrecognized strings', () => {
    expect(mapAnthropicStopReason('pause_turn')).toStrictEqual({
      finishReason: 'other',
      rawStopReason: 'pause_turn',
    });
  });
});

describe('isCanonicalFinishReason', () => {
  it('returns true for every canonical value', () => {
    expect(ALL_CANONICAL.length).toBeGreaterThan(0);
    for (const v of ALL_CANONICAL) {
      expect(isCanonicalFinishReason(v)).toBe(true);
    }
  });

  it('returns false for non-union strings', () => {
    expect(isCanonicalFinishReason('STOP')).toBe(false);
    expect(isCanonicalFinishReason('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isCanonicalFinishReason(42)).toBe(false);
    expect(isCanonicalFinishReason(null)).toBe(false);
    expect(isCanonicalFinishReason(undefined)).toBe(false);
    expect(isCanonicalFinishReason({ finishReason: 'stop' })).toBe(false);
    expect(isCanonicalFinishReason(['stop'])).toBe(false);
  });
});

describe('mapping tables export', () => {
  it('GEMINI_FINISH_MAP covers all 15 known enum strings', () => {
    const expected = [
      'STOP',
      'MAX_TOKENS',
      'SAFETY',
      'RECITATION',
      'LANGUAGE',
      'BLOCKLIST',
      'PROHIBITED_CONTENT',
      'SPII',
      'MALFORMED_FUNCTION_CALL',
      'OTHER',
      'IMAGE_SAFETY',
      'UNEXPECTED_TOOL_CALL',
      'IMAGE_PROHIBITED_CONTENT',
      'NO_IMAGE',
      'FINISH_REASON_UNSPECIFIED',
    ];
    for (const key of expected) {
      expect(GEMINI_FINISH_MAP[key]).toBeDefined();
    }
    // Ensure no extra or missing keys — catches removals AND additions.
    expect(Object.keys(GEMINI_FINISH_MAP).sort()).toStrictEqual(
      [...expected].sort(),
    );
  });

  it('OPENAI_FINISH_MAP covers known strings', () => {
    expect(OPENAI_FINISH_MAP['stop']).toBe('stop');
    expect(OPENAI_FINISH_MAP['length']).toBe('max_tokens');
    expect(OPENAI_FINISH_MAP['tool_calls']).toBe('tool_calls');
    expect(OPENAI_FINISH_MAP['function_call']).toBe('tool_calls');
    expect(OPENAI_FINISH_MAP['content_filter']).toBe('safety');
    expect(OPENAI_FINISH_MAP['refusal']).toBe('refusal');
  });

  it('ANTHROPIC_STOP_MAP covers known strings', () => {
    expect(ANTHROPIC_STOP_MAP['end_turn']).toBe('stop');
    expect(ANTHROPIC_STOP_MAP['max_tokens']).toBe('max_tokens');
    expect(ANTHROPIC_STOP_MAP['tool_use']).toBe('tool_calls');
    expect(ANTHROPIC_STOP_MAP['refusal']).toBe('refusal');
    expect(ANTHROPIC_STOP_MAP['stop_sequence']).toBe('stop');
  });

  // tryAllMappers (modelEnvelope.ts) probes the provider maps in a fixed
  // order (OpenAI → Anthropic → Gemini) and documents that this order is
  // irrelevant because no shared key maps to different canonical values.
  // This test ENFORCES that invariant: if a future map addition introduces
  // a conflicting shared key, order would silently start to matter for
  // unattributed stop reasons — fail loudly here instead.
  it('provider maps never disagree on a shared raw key (tryAllMappers order-independence)', () => {
    const tables: ReadonlyArray<[string, Readonly<Record<string, string>>]> = [
      ['OPENAI_FINISH_MAP', OPENAI_FINISH_MAP],
      ['ANTHROPIC_STOP_MAP', ANTHROPIC_STOP_MAP],
      ['GEMINI_FINISH_MAP', GEMINI_FINISH_MAP],
    ];

    const tablePairs = tables.flatMap(([nameA, mapA], i) =>
      tables
        .slice(i + 1)
        .map(([nameB, mapB]): [string, typeof mapA, string, typeof mapB] => [
          nameA,
          mapA,
          nameB,
          mapB,
        ]),
    );

    const conflicts = tablePairs.flatMap(([nameA, mapA, nameB, mapB]) =>
      Object.keys(mapA)
        .filter(
          (key) =>
            Object.prototype.hasOwnProperty.call(mapB, key) &&
            mapA[key] !== mapB[key],
        )
        .map(
          (key) =>
            `${nameA}[${key}]=${mapA[key]} vs ${nameB}[${key}]=${mapB[key]}`,
        ),
    );
    expect(conflicts).toStrictEqual([]);
  });
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('finishReasons property-based', () => {
  it.prop([fc.string({ maxLength: 50 })])(
    'for any string, mapGeminiFinishReason preserves rawStopReason and yields a canonical reason',
    (raw: string) => {
      const result = mapGeminiFinishReason(raw);
      return (
        result.rawStopReason === raw &&
        ALL_CANONICAL.includes(result.finishReason)
      );
    },
  );

  it.prop([fc.string({ maxLength: 50 })])(
    'for any string, mapOpenAIFinishReason preserves rawStopReason and yields a canonical reason',
    (raw: string) => {
      const result = mapOpenAIFinishReason(raw);
      return (
        result.rawStopReason === raw &&
        ALL_CANONICAL.includes(result.finishReason)
      );
    },
  );

  it.prop([fc.string({ maxLength: 50 })])(
    'for any string, mapAnthropicStopReason preserves rawStopReason and yields a canonical reason',
    (raw: string) => {
      const result = mapAnthropicStopReason(raw);
      return (
        result.rawStopReason === raw &&
        ALL_CANONICAL.includes(result.finishReason)
      );
    },
  );

  it.prop([
    fc.oneof(
      fc.constantFrom(...ALL_CANONICAL),
      fc.string().filter((s) => !CANONICAL_STRINGS.includes(s)),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
    ),
  ])(
    'isCanonicalFinishReason is true iff value is in the union set',
    (value: unknown) => {
      const result = isCanonicalFinishReason(value);
      const expected =
        typeof value === 'string' && CANONICAL_STRINGS.includes(value);
      return result === expected;
    },
  );

  it.prop([fc.constantFrom(...ALL_CANONICAL)])(
    'every canonical finish reason is recognized by isCanonicalFinishReason',
    (reason: CanonicalFinishReason) => isCanonicalFinishReason(reason) === true,
  );

  it.prop([fc.string({ maxLength: 30 })])(
    'mapGeminiFinishReason is pure: same input always yields same output',
    (raw) => {
      const r1 = mapGeminiFinishReason(raw);
      const r2 = mapGeminiFinishReason(raw);
      return (
        r1.finishReason === r2.finishReason &&
        r1.rawStopReason === r2.rawStopReason
      );
    },
  );

  it.prop([fc.string({ maxLength: 30 })])(
    'mapOpenAIFinishReason is pure: same input always yields same output',
    (raw) => {
      const r1 = mapOpenAIFinishReason(raw);
      const r2 = mapOpenAIFinishReason(raw);
      return (
        r1.finishReason === r2.finishReason &&
        r1.rawStopReason === r2.rawStopReason
      );
    },
  );

  it.prop([fc.string({ maxLength: 30 })])(
    'mapAnthropicStopReason is pure: same input always yields same output',
    (raw) => {
      const r1 = mapAnthropicStopReason(raw);
      const r2 = mapAnthropicStopReason(raw);
      return (
        r1.finishReason === r2.finishReason &&
        r1.rawStopReason === r2.rawStopReason
      );
    },
  );

  it.prop([fc.constantFrom(...Object.keys(GEMINI_FINISH_MAP))])(
    'every known Gemini FinishReason maps to a canonical value via GEMINI_FINISH_MAP',
    (raw: string) => {
      const result = mapGeminiFinishReason(raw);
      const expected = GEMINI_FINISH_MAP[raw];
      return result.finishReason === expected && result.rawStopReason === raw;
    },
  );

  it.prop([fc.constantFrom(...Object.keys(OPENAI_FINISH_MAP))])(
    'every known OpenAI finish reason maps via OPENAI_FINISH_MAP',
    (raw: string) => {
      const result = mapOpenAIFinishReason(raw);
      const expected = OPENAI_FINISH_MAP[raw];
      return result.finishReason === expected && result.rawStopReason === raw;
    },
  );

  it.prop([fc.constantFrom(...Object.keys(ANTHROPIC_STOP_MAP))])(
    'every known Anthropic stop reason maps via ANTHROPIC_STOP_MAP',
    (raw: string) => {
      const result = mapAnthropicStopReason(raw);
      const expected = ANTHROPIC_STOP_MAP[raw];
      return result.finishReason === expected && result.rawStopReason === raw;
    },
  );

  it.prop([fc.string({ maxLength: 1 })])(
    'single-char strings never crash any mapper and always return canonical',
    (raw: string) =>
      ALL_CANONICAL.includes(mapGeminiFinishReason(raw).finishReason) &&
      ALL_CANONICAL.includes(mapOpenAIFinishReason(raw).finishReason) &&
      ALL_CANONICAL.includes(mapAnthropicStopReason(raw).finishReason),
  );
});
