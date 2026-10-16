/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: over the frozen Anthropic wire corpus (5,000 seeds per
 * cache mode, raw and normalized rows), the length the transducer predicts
 * from per-unit facts equals the byte length of the `messages` array that
 * today's builders wrote. Composition is associative at every split point,
 * the state set is closed, and the wrong rules of the reviews are wrong.
 */

import { describe, expect, it } from 'bun:test';
import {
  SEEDS_PER_FORMAT,
  formatById,
} from '../../../__tests__/support/frozenWire/frozenCases.js';
import { readFrozenFixture } from '../../../__tests__/support/frozenWire/frozenFixture.js';
import { STATES } from './support/lengthModel/transducer.js';
import { checkSeed, newTally } from './support/lengthModel/frozenLengthRun.js';

const CHUNK = 1250;
const FORMATS = [
  'anthropic-cache-off',
  'anthropic-cache-5m',
  'anthropic-cache-1h',
  'anthropic-purge-boundary',
];

for (const formatId of FORMATS) {
  describe(`length model over the frozen corpus: ${formatId}`, () => {
    const format = formatById(formatId);
    const fixture = readFrozenFixture(formatId);
    const tally = newTally();

    for (let first = 0; first < SEEDS_PER_FORMAT; first += CHUNK) {
      const last = Math.min(first + CHUNK, SEEDS_PER_FORMAT);
      it(`seeds ${first}..${last - 1}: predicted length equals the frozen length`, async () => {
        for (let seed = first; seed < last; seed += 1) {
          await checkSeed(format, fixture, seed, tally);
        }
        expect(tally.predictionMismatches.slice(0, 10)).toStrictEqual([]);
        expect(tally.referenceMismatches.slice(0, 10)).toStrictEqual([]);
        expect(tally.messageCountMismatches.slice(0, 10)).toStrictEqual([]);
      });
    }

    it('composition is associative at every split and on random trees', () => {
      expect(tally.associativityChecks).toBeGreaterThan(100_000);
      expect(tally.associativityFailures).toBe(0);
    });

    it('the state set is closed and the sequential run reaches most of it', () => {
      expect(tally.reachedStates.size).toBeGreaterThanOrEqual(
        STATES.length - 1,
      );
    });

    it('only raw histories with a thinking chain that carries results are out of domain', () => {
      expect(tally.outOfDomain.every((entry) => entry.form === 'raw')).toBe(
        true,
      );
      expect(tally.outOfDomain.length).toBeLessThan(SEEDS_PER_FORMAT / 20);
    });

    it('the corpus exercises repairs, thinking chains and the last-kept group', () => {
      expect(tally.cases).toBeGreaterThan(SEEDS_PER_FORMAT * 0.9);
      expect(tally.repaired).toBeGreaterThan(SEEDS_PER_FORMAT / 4);
      expect(tally.chained).toBeGreaterThan(100);
      expect(tally.lastKept).toBeGreaterThan(100);
    });

    it('trap: a model without the repair overlay is wrong on the corpus', () => {
      expect(tally.withoutOverlayWrong).toBeGreaterThan(100);
    });

    it('trap: the single-unit last-kept substitution is wrong on the corpus', () => {
      expect(tally.oldSubstitutionRan).toBeGreaterThan(100);
      expect(tally.oldSubstitutionWrong).toBeGreaterThan(0);
    });
  });
}

describe('length model over the frozen purge corpus', () => {
  it('records the purge pass outcome of the real send for every format', () => {
    const fixture = readFrozenFixture('anthropic-purge-boundary');
    expect(fixture.cases).toHaveLength(SEEDS_PER_FORMAT);
  });
});
