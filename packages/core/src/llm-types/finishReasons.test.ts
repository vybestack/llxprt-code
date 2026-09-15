/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.1, REQ-001.4, REQ-001.5
 * @pseudocode lines 10-26
 */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import {
  isCanonicalFinishReason,
  CANONICAL_FINISH_REASONS,
  type CanonicalFinishReason,
  type FinishInfo,
} from './finishReasons.js';

const ALL_CANONICAL: readonly CanonicalFinishReason[] =
  CANONICAL_FINISH_REASONS;

const CANONICAL_STRINGS: readonly string[] = CANONICAL_FINISH_REASONS;

function isCanonicalForValue(value: unknown): boolean {
  return typeof value === 'string' && CANONICAL_STRINGS.includes(value);
}

// Compile-time shape check: FinishInfo pairs a canonical reason with its
// provider-native raw string. If either field changes type, this fails to
// compile instead of silently breaking provider mapping call sites.
const _finishInfoShape: FinishInfo = {
  finishReason: 'stop',
  rawStopReason: 'STOP',
};
void _finishInfoShape;

describe('CANONICAL_FINISH_REASONS', () => {
  it('contains exactly the seven canonical reasons — no extras, none missing', () => {
    const expected: readonly CanonicalFinishReason[] = [
      'stop',
      'max_tokens',
      'tool_calls',
      'safety',
      'refusal',
      'error',
      'other',
    ];
    expect([...CANONICAL_FINISH_REASONS].sort()).toStrictEqual(
      [...expected].sort(),
    );
  });

  it('has no duplicate entries', () => {
    expect(new Set(CANONICAL_FINISH_REASONS).size).toBe(
      CANONICAL_FINISH_REASONS.length,
    );
  });
});

describe('isCanonicalFinishReason', () => {
  it('returns true for every canonical value', () => {
    expect(ALL_CANONICAL.length).toBeGreaterThan(0);
    for (const v of ALL_CANONICAL) {
      expect(isCanonicalFinishReason(v)).toBe(true);
    }
  });

  it('returns false for provider-native raw strings', () => {
    expect(isCanonicalFinishReason('STOP')).toBe(false);
    expect(isCanonicalFinishReason('end_turn')).toBe(false);
    expect(isCanonicalFinishReason('TOOL_CALLS')).toBe(false);
  });

  it('returns false for the empty string', () => {
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

// ============================================================================
// Property-based tests
// ============================================================================

describe('finishReasons property-based', () => {
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
});
