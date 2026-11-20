/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: runs the chat length model over the frozen wire corpus.
 * The expected value is the byte length of the `messages` member that today's
 * builders wrote, recorded in the fixture; no builder runs here.
 */

import {
  caseOf,
  type FrozenFormat,
} from '../../../../__tests__/support/frozenWire/frozenCases.js';
import type { FrozenFixture } from '../../../../__tests__/support/frozenWire/frozenFixture.js';
import { analyzeChat, type ChatModelOptions } from './chatLengthModel.js';
import {
  frozenChatSettings,
  frozenSystemInstruction,
} from './frozenChatInputs.js';
import type { KimiNameRule } from './kimiIdFacts.js';

export interface ChatTally {
  cases: number;
  /** Seeds the builders rejected; the corpus records the error, not a length. */
  rejected: number;
  predictionMismatches: string[];
  associativityChecks: number;
  associativityFailures: number;
  reachedStates: Set<number>;
  withDropped: number;
  withMedia: number;
  normalized: number;
  mistralIdViolations: number;
  /** Kimi: the closed form with exceptions against the exact walk. */
  closedFormMismatches: string[];
  closedFormCleanViolations: number;
  /** Kimi control: the model without the exception list disagrees this often. */
  withoutExceptionsWrong: number;
  kimiDigitsAdded: number;
}

export function newChatTally(): ChatTally {
  return {
    cases: 0,
    rejected: 0,
    predictionMismatches: [],
    associativityChecks: 0,
    associativityFailures: 0,
    reachedStates: new Set(),
    withDropped: 0,
    withMedia: 0,
    normalized: 0,
    mistralIdViolations: 0,
    closedFormMismatches: [],
    closedFormCleanViolations: 0,
    withoutExceptionsWrong: 0,
    kimiDigitsAdded: 0,
  };
}

export interface ChatControl {
  readonly kimiRule?: KimiNameRule;
  readonly options?: ChatModelOptions;
}

/** The recorded length of the `messages` member of a seed, or undefined if it threw. */
function recordedMessages(
  fixture: FrozenFixture,
  seed: number,
): number | undefined {
  const entry = fixture.cases[seed];
  return entry[2] < 0 ? undefined : entry[4];
}

export async function checkChatSeed(
  format: FrozenFormat,
  fixture: FrozenFixture,
  seed: number,
  tally: ChatTally,
): Promise<void> {
  const frozen = await caseOf(format, seed);
  const member = recordedMessages(fixture, seed);
  if (member === undefined) {
    tally.rejected += 1;
    return;
  }
  const analysis = analyzeChat(
    frozen.rows,
    frozenChatSettings(format.id, frozen.settings),
    frozenSystemInstruction(frozen.settings),
    seed,
  );
  tally.cases += 1;
  if (analysis.predicted !== member) {
    tally.predictionMismatches.push(
      `seed ${seed}: predicted ${analysis.predicted}, frozen ${member}`,
    );
  }
  tally.associativityChecks += analysis.associativity.checks;
  tally.associativityFailures += analysis.associativity.failures;
  analysis.reached.forEach((state) => tally.reachedStates.add(state));
  if (analysis.withDropped) tally.withDropped += 1;
  if (analysis.withMedia) tally.withMedia += 1;
  if (frozen.settings.form === 'normalized') tally.normalized += 1;
  tally.mistralIdViolations += analysis.mistralIdViolations;
  const digits = analysis.kimiDigits;
  if (digits === undefined) return;
  if (digits.exact > 0) tally.kimiDigitsAdded += 1;
  if (
    digits.closed.digits !== digits.exact &&
    frozen.settings.form === 'normalized'
  ) {
    tally.closedFormMismatches.push(`seed ${seed}`);
  }
  if (frozen.settings.form === 'normalized') {
    tally.closedFormCleanViolations += digits.closed.cleanViolations;
  }
  if (analysis.predicted - digits.exact + digits.withoutExceptions !== member) {
    tally.withoutExceptionsWrong += 1;
  }
}

/**
 * Runs a wrong model over the corpus until it disagrees with a frozen length;
 * returns the first seed where it does, or undefined when it never does.
 */
export async function firstDisagreement(
  format: FrozenFormat,
  fixture: FrozenFixture,
  seeds: number,
  control: ChatControl,
): Promise<number | undefined> {
  for (let seed = 0; seed < seeds; seed += 1) {
    const member = recordedMessages(fixture, seed);
    if (member === undefined) continue;
    const frozen = await caseOf(format, seed);
    const analysis = analyzeChat(
      frozen.rows,
      frozenChatSettings(format.id, frozen.settings, control.kimiRule),
      frozenSystemInstruction(frozen.settings),
      seed,
      control.options,
    );
    if (analysis.predicted !== member) return seed;
  }
  return undefined;
}
