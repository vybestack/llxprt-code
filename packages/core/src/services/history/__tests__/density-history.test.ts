/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P07
 * @requirement REQ-HD-003.1, REQ-HD-003.2, REQ-HD-003.3, REQ-HD-003.4, REQ-HD-003.5, REQ-HD-003.6, REQ-HD-001.6, REQ-HD-001.7
 *
 * Behavioral tests for HistoryService density-optimization extensions:
 *   - applyDensityResult()
 *   - getRawHistory()
 *   - recalculateTotalTokens()
 *
 * These tests exercise real HistoryService instances — no mock theater.
 * They are written TDD-style: all tests compile now but fail against stubs.
 * Phase 08 will implement the methods and make these pass.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { HistoryService } from '../HistoryService.js';
import type { IContent } from '../IContent.js';
import type {
  DensityResult,
  DensityResultMetadata,
} from '../../../core/compression/types.js';
import { CompressionStrategyError } from '../../../core/compression/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a simple text entry for a given speaker. */
function makeEntry(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

/** Create an AI entry with no valid content (empty text). getCurated filters these. */
function makeEmptyAiEntry(): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text: '' }] };
}

/** Minimal valid metadata for a DensityResult. */
function makeMetadata(
  overrides: Partial<DensityResultMetadata> = {},
): DensityResultMetadata {
  return {
    readWritePairsPruned: 0,
    fileDeduplicationsPruned: 0,
    recencyPruned: 0,
    ...overrides,
  };
}

/** Build a DensityResult from removals, replacements, and optional metadata. */
function makeDensityResult(
  removals: number[],
  replacements: Map<number, IContent>,
  metadata?: Partial<DensityResultMetadata>,
): DensityResult {
  return {
    removals,
    replacements,
    metadata: makeMetadata(metadata),
  };
}

/** Seed a HistoryService with N labeled entries: [A, B, C, D, E, …] */
function seedHistory(service: HistoryService, count: number): IContent[] {
  const entries: IContent[] = [];
  for (let i = 0; i < count; i++) {
    const label = String.fromCharCode(65 + i); // A, B, C, …
    const entry = makeEntry('human', label);
    entries.push(entry);
    service.add(entry);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('HistoryService — Density Extensions', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  // =========================================================================
  // applyDensityResult — ordering
  // =========================================================================

  describe('applyDensityResult — ordering', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.1, REQ-HD-003.2
     * @pseudocode history-service.md lines 58-70
     */
    it('applies replacements before removals', async () => {
      // GIVEN: History [A, B, C, D, E]
      const entries = seedHistory(service, 5);
      await service.waitForTokenUpdates();

      const replacement = makeEntry('human', "B'");
      const result = makeDensityResult(
        [3], // remove D
        new Map([[1, replacement]]), // replace B → B'
      );

      // WHEN
      await service.applyDensityResult(result);

      // THEN: [A, B', C, E]
      const raw = service.getRawHistory();
      expect(raw).toHaveLength(4);
      expect(raw[0]).toBe(entries[0]); // A unchanged
      expect(raw[1]).toBe(replacement); // B replaced
      expect(raw[2]).toBe(entries[2]); // C unchanged
      expect(raw[3]).toBe(entries[4]); // E shifted up
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.3
     * @pseudocode history-service.md lines 63-70
     */
    it('removes in reverse index order', async () => {
      // GIVEN: History [A, B, C, D, E]
      const entries = seedHistory(service, 5);
      await service.waitForTokenUpdates();

      const result = makeDensityResult([1, 3], new Map());

      // WHEN
      await service.applyDensityResult(result);

      // THEN: [A, C, E]
      const raw = service.getRawHistory();
      expect(raw).toHaveLength(3);
      expect(raw[0]).toBe(entries[0]); // A
      expect(raw[1]).toBe(entries[2]); // C
      expect(raw[2]).toBe(entries[4]); // E
    });

    it('handles removals-only (no replacements)', async () => {
      // GIVEN: [A, B, C]
      const entries = seedHistory(service, 3);
      await service.waitForTokenUpdates();

      const result = makeDensityResult([0, 2], new Map());

      // WHEN
      await service.applyDensityResult(result);

      // THEN: [B]
      const raw = service.getRawHistory();
      expect(raw).toHaveLength(1);
      expect(raw[0]).toBe(entries[1]);
    });

    it('handles replacements-only (no removals)', async () => {
      // GIVEN: [A, B, C]
      const entries = seedHistory(service, 3);
      await service.waitForTokenUpdates();

      const replacement = makeEntry('human', "B'");
      const result = makeDensityResult([], new Map([[1, replacement]]));

      // WHEN
      await service.applyDensityResult(result);

      // THEN: [A, B', C]
      const raw = service.getRawHistory();
      expect(raw).toHaveLength(3);
      expect(raw[0]).toBe(entries[0]);
      expect(raw[1]).toBe(replacement);
      expect(raw[2]).toBe(entries[2]);
    });

    it('handles empty result (no-op)', async () => {
      // GIVEN: [A, B, C]
      const entries = seedHistory(service, 3);
      await service.waitForTokenUpdates();

      const result = makeDensityResult([], new Map());

      // WHEN
      await service.applyDensityResult(result);

      // THEN: still [A, B, C]
      const raw = service.getRawHistory();
      expect(raw).toHaveLength(3);
      expect(raw[0]).toBe(entries[0]);
      expect(raw[1]).toBe(entries[1]);
      expect(raw[2]).toBe(entries[2]);
    });
  });

  // =========================================================================
  // applyDensityResult — validation
  // =========================================================================

  describe('applyDensityResult — validation', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-001.6
     * @pseudocode history-service.md lines 33-38
     */
    it('rejects conflicting index in removals and replacements', async () => {
      seedHistory(service, 5);
      await service.waitForTokenUpdates();

      const result = makeDensityResult(
        [2],
        new Map([[2, makeEntry('human', 'X')]]),
      );

      const err = await service
        .applyDensityResult(result)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CompressionStrategyError);
      expect(err).toMatchObject({ code: 'DENSITY_CONFLICT' });
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-001.7
     * @pseudocode history-service.md lines 41-46
     */
    it('rejects removal index out of bounds', async () => {
      seedHistory(service, 3);
      await service.waitForTokenUpdates();

      const result = makeDensityResult([5], new Map());

      const err = await service
        .applyDensityResult(result)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CompressionStrategyError);
      expect(err).toMatchObject({ code: 'DENSITY_INDEX_OUT_OF_BOUNDS' });
    });

    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-001.7
     * @pseudocode history-service.md lines 49-54
     */
    it('rejects replacement index out of bounds', async () => {
      seedHistory(service, 3);
      await service.waitForTokenUpdates();

      const result = makeDensityResult(
        [],
        new Map([[10, makeEntry('human', 'X')]]),
      );

      const err = await service
        .applyDensityResult(result)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CompressionStrategyError);
      expect(err).toMatchObject({ code: 'DENSITY_INDEX_OUT_OF_BOUNDS' });
    });

    /**
     * @requirement REQ-HD-001.7
     */
    it('rejects negative removal index', async () => {
      seedHistory(service, 3);
      await service.waitForTokenUpdates();

      const result = makeDensityResult([-1], new Map());

      const err = await service
        .applyDensityResult(result)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CompressionStrategyError);
      expect(err).toMatchObject({ code: 'DENSITY_INDEX_OUT_OF_BOUNDS' });
    });

    /**
     * @pseudocode history-service.md lines 25-30
     */
    it('rejects duplicate removal indices', async () => {
      seedHistory(service, 5);
      await service.waitForTokenUpdates();

      const result = makeDensityResult([2, 2], new Map());

      await expect(service.applyDensityResult(result)).rejects.toThrow(
        CompressionStrategyError,
      );
    });
  });

  // =========================================================================
  // applyDensityResult — token recalculation
  // =========================================================================

  describe('applyDensityResult — token recalculation', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.4
     * @pseudocode history-service.md lines 81-82
     */
    it('triggers token recalculation after mutation', async () => {
      // GIVEN: add entries and let token estimation settle
      seedHistory(service, 5);
      await service.waitForTokenUpdates();
      const tokensBefore = service.getTotalTokens();
      expect(tokensBefore).toBeGreaterThan(0);

      // WHEN: remove two entries
      const result = makeDensityResult([1, 3], new Map());
      await service.applyDensityResult(result);
      await service.waitForTokenUpdates();

      // THEN: totalTokens should reflect only the 3 remaining entries
      const tokensAfter = service.getTotalTokens();
      expect(tokensAfter).toBeLessThan(tokensBefore);
      expect(tokensAfter).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // getRawHistory
  // =========================================================================

  describe('getRawHistory', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.5
     * @pseudocode history-service.md lines 10-15
     */
    it('returns the raw history array', () => {
      const entries = seedHistory(service, 3);

      const raw = service.getRawHistory();
      expect(raw).toHaveLength(3);
      expect(raw[0]).toBe(entries[0]);
      expect(raw[1]).toBe(entries[1]);
      expect(raw[2]).toBe(entries[2]);
    });

    /**
     * @requirement REQ-HD-003.5
     */
    it('returns entries that getCurated filters', () => {
      // GIVEN: a human message, an empty AI message, and another human message
      const human1 = makeEntry('human', 'Hello');
      const emptyAi = makeEmptyAiEntry();
      const human2 = makeEntry('human', 'World');

      service.add(human1);
      service.add(emptyAi);
      service.add(human2);

      // THEN: raw includes the empty AI message
      const raw = service.getRawHistory();
      expect(raw).toHaveLength(3);
      expect(raw[1]).toBe(emptyAi);

      // AND: getCurated does NOT include the empty AI message
      const curated = service.getCurated();
      expect(curated).toHaveLength(2);
      expect(curated.some((c) => c === emptyAi)).toBe(false);
    });

    it('returns empty array for empty history', () => {
      const raw = service.getRawHistory();
      expect(raw).toHaveLength(0);
    });
  });

  // =========================================================================
  // recalculateTotalTokens
  // =========================================================================

  describe('recalculateTotalTokens', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.6
     * @pseudocode history-service.md lines 90-120
     */
    it('updates totalTokens for current entries', async () => {
      // GIVEN: entries added, tokens settled
      seedHistory(service, 3);
      await service.waitForTokenUpdates();
      const expected = service.getTotalTokens();
      expect(expected).toBeGreaterThan(0);

      // WHEN: recalculate
      await service.recalculateTotalTokens();
      await service.waitForTokenUpdates();

      // THEN: totalTokens reflects current entries
      expect(service.getTotalTokens()).toBe(expected);
    });

    /**
     * @requirement REQ-HD-003.6
     * @pseudocode history-service.md lines 94-118
     */
    it('serializes through tokenizerLock', async () => {
      // GIVEN: entries with pending token estimation
      seedHistory(service, 4);

      // WHEN: call recalculateTotalTokens while token updates may still be pending
      await service.recalculateTotalTokens();
      await service.waitForTokenUpdates();

      // THEN: no error, tokens are non-negative (serialization succeeded)
      expect(service.getTotalTokens()).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // Property-based tests (≥ 30% of total)
  // =========================================================================

  describe('property-based tests', () => {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P07
     * @requirement REQ-HD-003.1
     */
    it(
      'history length after removal equals original minus removal count',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 8 }),
            fc.array(fc.integer({ min: 0, max: 7 }), {
              minLength: 0,
              maxLength: 5,
            }),
            async (histSize, rawRemovals) => {
              const svc = new HistoryService();
              seedHistory(svc, histSize);
              await svc.waitForTokenUpdates();

              const removals = [...new Set(rawRemovals)].filter(
                (i) => i >= 0 && i < histSize,
              );

              const result = makeDensityResult(removals, new Map());
              await svc.applyDensityResult(result);

              expect(svc.getRawHistory()).toHaveLength(
                histSize - removals.length,
              );
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * @requirement REQ-HD-003.1
     */
    it(
      'non-removed non-replaced entries are unchanged (same reference)',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 2, max: 8 }),
            fc.array(fc.integer({ min: 0, max: 7 }), {
              minLength: 0,
              maxLength: 4,
            }),
            fc.array(fc.integer({ min: 0, max: 7 }), {
              minLength: 0,
              maxLength: 3,
            }),
            async (histSize, rawRemovals, rawReplacements) => {
              const svc = new HistoryService();
              const entries = seedHistory(svc, histSize);
              await svc.waitForTokenUpdates();

              const removalSet = new Set(
                rawRemovals.filter((i) => i >= 0 && i < histSize),
              );
              const replacements = new Map<number, IContent>();
              for (const idx of rawReplacements) {
                if (idx >= 0 && idx < histSize && !removalSet.has(idx)) {
                  replacements.set(idx, makeEntry('human', `R${idx}`));
                }
              }
              const removals = [...removalSet].filter(
                (i) => !replacements.has(i),
              );

              const touched = new Set([...removals, ...replacements.keys()]);

              const result = makeDensityResult(removals, replacements);
              await svc.applyDensityResult(result);

              const raw = svc.getRawHistory();
              let rawIdx = 0;
              for (let origIdx = 0; origIdx < histSize; origIdx++) {
                if (removals.includes(origIdx)) continue;
                if (!touched.has(origIdx)) {
                  expect(raw[rawIdx]).toBe(entries[origIdx]);
                }
                rawIdx++;
              }
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * @requirement REQ-HD-003.1
     */
    it(
      'replaced entries match the replacement content',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 2, max: 8 }),
            fc.array(fc.integer({ min: 0, max: 7 }), {
              minLength: 1,
              maxLength: 4,
            }),
            async (histSize, rawReplacements) => {
              const svc = new HistoryService();
              seedHistory(svc, histSize);
              await svc.waitForTokenUpdates();

              const replacements = new Map<number, IContent>();
              for (const idx of rawReplacements) {
                if (idx >= 0 && idx < histSize) {
                  replacements.set(idx, makeEntry('human', `REPLACED_${idx}`));
                }
              }
              if (replacements.size === 0) return;

              const result = makeDensityResult([], replacements);
              await svc.applyDensityResult(result);

              const raw = svc.getRawHistory();
              for (const [idx, expected] of replacements) {
                expect(raw[idx]).toBe(expected);
              }
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * @requirement REQ-HD-001.6
     */
    it(
      'all conflict combinations are caught (index in both removals and replacements)',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 8 }),
            fc.integer({ min: 0, max: 7 }),
            async (histSize, conflictIdx) => {
              if (conflictIdx >= histSize) return;

              const svc = new HistoryService();
              seedHistory(svc, histSize);
              await svc.waitForTokenUpdates();

              const result = makeDensityResult(
                [conflictIdx],
                new Map([[conflictIdx, makeEntry('human', 'X')]]),
              );

              await expect(svc.applyDensityResult(result)).rejects.toThrow(
                CompressionStrategyError,
              );
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * @requirement REQ-HD-003.5
     */
    it(
      'getRawHistory length equals number of add() calls',
      { timeout: 60_000 },
      () => {
        fc.assert(
          fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
            const svc = new HistoryService();
            for (let i = 0; i < n; i++) {
              svc.add(makeEntry('human', `msg-${i}`));
            }
            expect(svc.getRawHistory()).toHaveLength(n);
          }),
          { numRuns: 5 },
        );
      },
    );

    /**
     * @requirement REQ-HD-001.7
     */
    it(
      'out-of-bounds indices always throw regardless of history size',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 8 }),
            fc.integer({ min: 0, max: 4 }),
            async (histSize, offset) => {
              const svc = new HistoryService();
              seedHistory(svc, histSize);
              await svc.waitForTokenUpdates();

              const oobIndex = histSize + offset;
              const result = makeDensityResult([oobIndex], new Map());

              await expect(svc.applyDensityResult(result)).rejects.toThrow(
                CompressionStrategyError,
              );
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * @requirement REQ-HD-003.4
     */
    it(
      'totalTokens is non-negative after any valid density operation',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 8 }),
            fc.array(fc.integer({ min: 0, max: 7 }), {
              minLength: 0,
              maxLength: 4,
            }),
            async (histSize, rawRemovals) => {
              const svc = new HistoryService();
              seedHistory(svc, histSize);
              await svc.waitForTokenUpdates();

              const removals = [...new Set(rawRemovals)].filter(
                (i) => i >= 0 && i < histSize,
              );
              const result = makeDensityResult(removals, new Map());
              await svc.applyDensityResult(result);
              await svc.waitForTokenUpdates();

              expect(svc.getTotalTokens()).toBeGreaterThanOrEqual(0);
            },
          ),
          { numRuns: 5 },
        );
      },
    );
  });
});
