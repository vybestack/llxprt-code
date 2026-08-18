/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Parse-only fixture for scripts/tests/test-audit-scan.bun.test.ts.
// Deliberately NOT named *.test.* so bun never executes it: it contains
// known false-green smells that the scanner must detect. Every smell test
// below would pass forever regardless of the production logic.
import { describe, it, expect, vi } from 'bun:test';

class LabelManager {
  constructor(private readonly fetchLabel: () => string) {}
  labelFor(_key: string): string {
    return this.fetchLabel();
  }
}

function compute(n: number): number {
  return n * 2;
}

function risky(): void {
  throw new Error('boom');
}

describe('fixture smells (parse-only, never executed)', () => {
  it('echoes the stub literal back', () => {
    const fetchLabel = vi.fn().mockReturnValue('EXPECTED_LABEL');
    const manager = new LabelManager(fetchLabel);
    const result = manager.labelFor('x');
    expect(result).toBe('EXPECTED_LABEL');
  });

  it('compares a literal to itself', () => {
    expect('stable').toBe('stable');
  });

  it('checks a non-negative length', () => {
    const items = [1, 2, 3];
    expect(items.length).toBeGreaterThanOrEqual(0);
  });

  it('compares a reference to itself', () => {
    const ref = { a: 1 };
    expect(ref).toBe(ref);
  });

  it('has no assertions', () => {
    const x = compute(2);
    if (x === 999) throw new Error('unreachable');
  });

  it('asserts only inside catch', () => {
    try {
      risky();
    } catch (e) {
      expect(String(e)).toContain('boom');
    }
  });

  it('duplicates an assertion', () => {
    const total = compute(4);
    expect(total).toBe(8);
    expect(total).toBe(8);
  });

  it('asserts a derived property (clean negative control)', () => {
    const tags = [
      { tag: 'b', at: 2 },
      { tag: 'a', at: 1 },
    ];
    const ordered = [...tags].sort((p, q) => p.at - q.at);
    expect(ordered.map((t) => t.tag)).toEqual(['a', 'b']);
  });

  it('only asserts a snapshot match', () => {
    const result = { nested: { value: 42 } };
    expect(result).toMatchSnapshot();
  });

  it('uses it.each to check parametric cases', () => {
    const cases: Array<[number, number]> = [
      [1, 2],
      [2, 4],
      [3, 6],
    ];
    for (const [input, expected] of cases) {
      expect(compute(input)).toBe(expected);
    }
  });

  it.each([
    [1, 2],
    [2, 4],
    [3, 6],
  ])('it.each case: compute(%i) === %i', (input, expected) => {
    expect(compute(input)).toBe(expected);
  });

  it('negates an expectation without a false-green smell', () => {
    const items: string[] = ['b', 'a', 'c'];
    // Use .not with a genuine negation — the scanner must parse this
    // as a real assertion (not ALWAYS_TRUE, not EXPECT_NO_MATCHER).
    expect(items).not.toHaveLength(0);
    // Also assert a derived transformation — sorted form equals itself
    // (not a mirror — the stub is not configured with this value).
    expect([...items].sort()).toEqual(['a', 'b', 'c']);
  });

  it('has a transformed shared-literal assertion plus an unrelated plain assertion (MOCK_MIRROR negative control)', () => {
    // The stub returns 'SHARED' and the test asserts a transformation
    // (toUpperCase + suffix) of that literal — not the literal itself.
    // A separate plain assertion checks an unrelated value. The scanner
    // must NOT flag this as MOCK_MIRROR: the shared-literal expectation
    // is transformed, and the plain expectation does not use the shared
    // literal.
    const stub = vi.fn().mockReturnValue('SHARED');
    const result = `${stub().toUpperCase()}_SENTINEL`;
    expect(result).toBe('SHARED_SENTINEL');

    const unrelated = compute(3);
    expect(unrelated).toBe(6);
  });
});
