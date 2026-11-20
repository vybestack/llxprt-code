/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the test body shared by the per-format chat length
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
  checkChatSeed,
  firstDisagreement,
  newChatTally,
  type ChatTally,
} from './frozenChatRun.js';

const CHUNK = 1250;

export interface ChatFormatContext {
  readonly format: FrozenFormat;
  readonly fixture: FrozenFixture;
  readonly tally: ChatTally;
}

function describeCoverage({ fixture, tally }: ChatFormatContext): void {
  it('the builders rejected exactly the seeds the fixture records as thrown', () => {
    const thrown = fixture.cases.filter((entry) => entry[2] < 0).length;
    expect(tally.rejected).toBe(thrown);
    expect(tally.cases + tally.rejected).toBe(SEEDS_PER_FORMAT);
  });

  it('composition is associative at every split and on random trees', () => {
    expect(tally.associativityChecks).toBeGreaterThan(50_000);
    expect(tally.associativityFailures).toBe(0);
  });

  it('the sequential run reaches the states after a message, with and without pending images', () => {
    // The corpus has no tool video; the state with a video pending is checked
    // in the counterexample file.
    expect([...tally.reachedStates].sort()).toStrictEqual([3, 4]);
  });

  it('the corpus exercises dropped tool messages, tool media and normalized rows', () => {
    expect(tally.withDropped).toBeGreaterThan(500);
    expect(tally.withMedia).toBeGreaterThan(500);
    expect(tally.normalized).toBeGreaterThan(SEEDS_PER_FORMAT / 3);
  });
}

function describeNoPendingControl({
  format,
  fixture,
}: ChatFormatContext): void {
  it('trap: a model without the pending media bytes (P) is wrong on the corpus', async () => {
    const seed = await firstDisagreement(format, fixture, SEEDS_PER_FORMAT, {
      options: { ignoreMediaParts: true },
    });
    expect(seed).toBeDefined();
  });
}

function describeMistralFacts({ tally }: ChatFormatContext): void {
  it('every mapped Mistral id on the wire is nine alphanumeric characters', () => {
    expect(tally.mistralIdViolations).toBe(0);
  });
}

function describeKimiFacts({ tally }: ChatFormatContext): void {
  it('the digits of the index are part of the length on most seeds', () => {
    expect(tally.kimiDigitsAdded).toBeGreaterThan(SEEDS_PER_FORMAT / 2);
  });

  it('the closed form with its exception list equals the exact walk on normalized rows', () => {
    expect(tally.closedFormMismatches.slice(0, 10)).toStrictEqual([]);
    expect(tally.closedFormCleanViolations).toBe(0);
  });
}

function describeKimiControls({
  format,
  fixture,
  tally,
}: ChatFormatContext): void {
  it('trap: a model with no exception list is wrong on the corpus', () => {
    expect(tally.withoutExceptionsWrong).toBeGreaterThan(0);
  });

  it("trap: a model that names each id after the call's own name is wrong on the corpus", async () => {
    const seed = await firstDisagreement(format, fixture, SEEDS_PER_FORMAT, {
      kimiRule: 'ownName',
    });
    expect(seed).toBeDefined();
  });

  it('trap: a model that takes the last raw name, eligible or not, is wrong on the corpus', async () => {
    const seed = await firstDisagreement(format, fixture, SEEDS_PER_FORMAT, {
      kimiRule: 'lastRawName',
    });
    expect(seed).toBeDefined();
  });
}

/** Defines the frozen-corpus tests of one chat format. */
export function defineChatFrozenTests(formatId: string): void {
  describe(`chat length model over the frozen corpus: ${formatId}`, () => {
    const context: ChatFormatContext = {
      format: formatById(formatId),
      fixture: readFrozenFixture(formatId),
      tally: newChatTally(),
    };

    for (let first = 0; first < SEEDS_PER_FORMAT; first += CHUNK) {
      const last = Math.min(first + CHUNK, SEEDS_PER_FORMAT);
      it(`seeds ${first}..${last - 1}: predicted length equals the frozen length`, async () => {
        for (let seed = first; seed < last; seed += 1) {
          await checkChatSeed(
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
    describeNoPendingControl(context);
    if (formatId === 'openai-chat-mistral') describeMistralFacts(context);
    if (formatId === 'openai-chat-kimi') {
      describeKimiFacts(context);
      describeKimiControls(context);
    }
  });
}
