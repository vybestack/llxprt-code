/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4, REQ-001.5
 * @pseudocode lines 10-26
 */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import {
  mapGeminiFinishReason,
  isCanonicalFinishReason,
  GEMINI_FINISH_MAP,
  CANONICAL_FINISH_REASONS,
  type CanonicalFinishReason,
  type FinishInfo,
} from './finishReasons.js';

const ALL_CANONICAL = CANONICAL_FINISH_REASONS;

const CANONICAL_STRINGS: readonly string[] = ALL_CANONICAL;

/**
 * True when a mapping preserves the raw stop reason and produced one of the canonical
 * finish reasons.
 */
function preservesRawWithCanonical(result: FinishInfo, raw: string): boolean {
  return (
    result.rawStopReason === raw && ALL_CANONICAL.includes(result.finishReason)
  );
}

function isCanonicalForValue(value: unknown): boolean {
  return typeof value === 'string' && CANONICAL_STRINGS.includes(value);
}

function sameMappingResult(r1: FinishInfo, r2: FinishInfo): boolean {
  return (
    r1.finishReason === r2.finishReason && r1.rawStopReason === r2.rawStopReason
  );
}

function mappedToExpected(
  result: FinishInfo,
  raw: string,
  expected: CanonicalFinishReason,
): boolean {
  return result.finishReason === expected && result.rawStopReason === raw;
}

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
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('finishReasons property-based', () => {
  it('for any string, mapGeminiFinishReason preserves rawStopReason and yields a canonical reason', () =>
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), (raw: string) =>
        preservesRawWithCanonical(mapGeminiFinishReason(raw), raw),
      ),
    ));

  it('isCanonicalFinishReason is true iff value is in the union set', () =>
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...ALL_CANONICAL),
          fc.string().filter((s) => !CANONICAL_STRINGS.includes(s)),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
        ),
        (value: unknown) =>
          isCanonicalFinishReason(value) === isCanonicalForValue(value),
      ),
    ));

  it('every canonical finish reason is recognized by isCanonicalFinishReason', () =>
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CANONICAL),
        (reason: CanonicalFinishReason) =>
          isCanonicalFinishReason(reason) === true,
      ),
    ));

  it('mapGeminiFinishReason is pure: same input always yields same output', () =>
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (raw) => {
        const r1 = mapGeminiFinishReason(raw);
        const r2 = mapGeminiFinishReason(raw);
        return sameMappingResult(r1, r2);
      }),
    ));

  it('every known Gemini FinishReason maps to a canonical value via GEMINI_FINISH_MAP', () =>
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(GEMINI_FINISH_MAP)),
        (raw: string) =>
          mappedToExpected(
            mapGeminiFinishReason(raw),
            raw,
            GEMINI_FINISH_MAP[raw],
          ),
      ),
    ));
});
