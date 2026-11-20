/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the test body shared by the per-format Responses length
 * model files. Each format has its own file so a run stays far below the
 * per-test limit.
 */

import { describe, expect, it } from 'bun:test';
import {
  SEEDS_PER_FORMAT,
  formatById,
  type FrozenFormat,
} from '../../../../__tests__/support/frozenWire/frozenCases.js';
import {
  readFrozenFixture,
  type FrozenFixture,
} from '../../../../__tests__/support/frozenWire/frozenFixture.js';
import {
  checkResponsesSeed,
  firstPairRuleDisagreement,
  newResponsesTally,
  type ResponsesTally,
} from './frozenResponsesRun.js';

const CHUNK = 1250;

interface FormatContext {
  readonly format: FrozenFormat;
  readonly fixture: FrozenFixture;
  readonly tally: ResponsesTally;
}

function describeCoverage({ fixture, tally }: FormatContext): void {
  it('the builders rejected exactly the seeds the fixture records as thrown', () => {
    const thrown = fixture.cases.filter((entry) => entry[2] < 0).length;
    expect(tally.rejected).toBe(thrown);
  });

  it('only raw histories with an unanswered call are out of domain, and normalization leaves none', () => {
    // A raw history with an unanswered call takes the builder's synthetic
    // cancel branch, which the design deletes; the normalized stream the
    // design feeds never has one.
    expect(tally.danglingNormalized).toBe(0);
    expect(tally.cases + tally.rejected + tally.outOfDomainRaw).toBe(
      SEEDS_PER_FORMAT,
    );
    expect(tally.cases).toBeGreaterThan(SEEDS_PER_FORMAT / 2);
  });

  it('composition is associative at every split and on random trees', () => {
    expect(tally.associativityChecks).toBeGreaterThan(50_000);
    expect(tally.associativityFailures).toBe(0);
  });

  it('the sequential run reaches both boundary states', () => {
    expect([...tally.reachedStates].sort()).toStrictEqual([0, 1]);
  });

  it('the corpus exercises generated reasoning ids, PDF parts, empty input and normalized rows', () => {
    expect(tally.withGeneratedIds).toBeGreaterThan(100);
    expect(tally.withInputFile).toBeGreaterThan(100);
    expect(tally.emptyInput).toBeGreaterThan(0);
    expect(tally.normalized).toBeGreaterThan(SEEDS_PER_FORMAT / 3);
    expect(tally.indexLookups).toBeGreaterThan(1000);
  });
}

function describeShortcutControl({ format, fixture }: FormatContext): void {
  it('trap: the design-7.3 pair shortcut (every non-empty call id has a response) is wrong on the corpus', async () => {
    const seed = await firstPairRuleDisagreement(
      format,
      fixture,
      SEEDS_PER_FORMAT,
      'designShortcut',
    );
    expect(seed).toBeDefined();
  });
}

export function defineResponsesFrozenTests(formatId: string): void {
  describe(`Responses length model over the frozen corpus: ${formatId}`, () => {
    const context: FormatContext = {
      format: formatById(formatId),
      fixture: readFrozenFixture(formatId),
      tally: newResponsesTally(),
    };

    for (let first = 0; first < SEEDS_PER_FORMAT; first += CHUNK) {
      const last = Math.min(first + CHUNK, SEEDS_PER_FORMAT);
      it(`seeds ${first}..${last - 1}: predicted length equals the frozen length`, async () => {
        for (let seed = first; seed < last; seed += 1) {
          await checkResponsesSeed(
            context.format,
            context.fixture,
            seed,
            context.tally,
          );
        }
        expect(context.tally.predictionMismatches.slice(0, 10)).toStrictEqual(
          [],
        );
      });
    }

    describeCoverage(context);
    describeShortcutControl(context);
  });
}
