/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: runs the Responses length model over the frozen wire
 * corpus. The expected value is the byte length of the `input` member that
 * today's builders wrote, recorded in the fixture; no builder runs here.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  caseOf,
  type FrozenFormat,
  type FrozenSettings,
} from '../../../../__tests__/support/frozenWire/frozenCases.js';
import type { FrozenFixture } from '../../../../__tests__/support/frozenWire/frozenFixture.js';
import { findDanglingCalls } from '../../../responses-dangling-calls.js';
import {
  FULL_STATELESS_SEND,
  analyzeResponses,
  type PairRule,
} from './responsesLengthModel.js';
import type { ResponsesSettings } from './responsesUnitFacts.js';

export interface ResponsesTally {
  cases: number;
  /** Seeds the builders rejected; the corpus records the error, not a length. */
  rejected: number;
  /** Raw histories with an unanswered call take the synthetic-cancel branch. */
  outOfDomainRaw: number;
  /** Normalized streams that still leave a call unanswered (the claim is none). */
  danglingNormalized: number;
  predictionMismatches: string[];
  associativityChecks: number;
  associativityFailures: number;
  reachedStates: Set<number>;
  withGeneratedIds: number;
  withInputFile: number;
  emptyInput: number;
  normalized: number;
  indexLookups: number;
}

export function newResponsesTally(): ResponsesTally {
  return {
    cases: 0,
    rejected: 0,
    outOfDomainRaw: 0,
    danglingNormalized: 0,
    predictionMismatches: [],
    associativityChecks: 0,
    associativityFailures: 0,
    reachedStates: new Set(),
    withGeneratedIds: 0,
    withInputFile: 0,
    emptyInput: 0,
    normalized: 0,
    indexLookups: 0,
  };
}

/** Both settings default to on; only an explicit `false` turns them off. */
export function frozenResponsesSettings(
  settings: FrozenSettings,
  pinnedClock: string,
): ResponsesSettings {
  return {
    includeReasoning:
      settings.ephemerals['reasoning.includeInContext'] !== false,
    pdfEnabled: settings.ephemerals['media.pdf.enabled'] !== false,
    reasoningIdTime: Date.parse(pinnedClock),
  };
}

/** The recorded length of the `input` member of a seed, or undefined if it threw. */
function recordedInput(
  fixture: FrozenFixture,
  seed: number,
): number | undefined {
  const entry = fixture.cases[seed];
  return entry[2] < 0 ? undefined : entry[4];
}

async function leavesCalls(units: readonly IContent[]): Promise<boolean> {
  const dangling = await findDanglingCalls(async function* () {
    yield* structuredClone([...units]);
  });
  return dangling.missing.size > 0;
}

export async function checkResponsesSeed(
  format: FrozenFormat,
  fixture: FrozenFixture,
  seed: number,
  tally: ResponsesTally,
): Promise<void> {
  const frozen = await caseOf(format, seed);
  const member = recordedInput(fixture, seed);
  if (member === undefined) {
    tally.rejected += 1;
    return;
  }
  const normalized = frozen.settings.form === 'normalized';
  if (await leavesCalls(frozen.rows)) {
    if (!normalized) {
      tally.outOfDomainRaw += 1;
      return;
    }
    tally.danglingNormalized += 1;
  }
  const analysis = analyzeResponses(
    frozen.rows,
    frozenResponsesSettings(frozen.settings, fixture.pinnedClock),
    FULL_STATELESS_SEND,
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
  analysis.reachedStates.forEach((state) => tally.reachedStates.add(state));
  if (analysis.generatedIds > 0) tally.withGeneratedIds += 1;
  if (analysis.pdfBytes > 0) tally.withInputFile += 1;
  if (analysis.items === 0) tally.emptyInput += 1;
  if (normalized) tally.normalized += 1;
  tally.indexLookups += analysis.indexLookups;
}

/**
 * The frozen case and its recorded length, or undefined when the seed is
 * outside the model's domain: the builders threw, or a raw history leaves a
 * call unanswered.
 */
async function comparableCase(
  format: FrozenFormat,
  fixture: FrozenFixture,
  seed: number,
): Promise<
  { frozen: Awaited<ReturnType<typeof caseOf>>; member: number } | undefined
> {
  const member = recordedInput(fixture, seed);
  if (member === undefined) return undefined;
  const frozen = await caseOf(format, seed);
  if (frozen.settings.form === 'raw' && (await leavesCalls(frozen.rows))) {
    return undefined;
  }
  return { frozen, member };
}

/**
 * Runs the model with a wrong pair rule over the corpus until it disagrees
 * with a frozen length; returns that seed, or undefined when it never does.
 */
export async function firstPairRuleDisagreement(
  format: FrozenFormat,
  fixture: FrozenFixture,
  seeds: number,
  pairRule: PairRule,
): Promise<number | undefined> {
  for (let seed = 0; seed < seeds; seed += 1) {
    const comparable = await comparableCase(format, fixture, seed);
    if (comparable === undefined) continue;
    const { frozen, member } = comparable;
    const analysis = analyzeResponses(
      frozen.rows,
      frozenResponsesSettings(frozen.settings, fixture.pinnedClock),
      { ...FULL_STATELESS_SEND, pairRule },
      seed,
    );
    if (analysis.predicted !== member) return seed;
  }
  return undefined;
}
