/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: runs the length model over the frozen Anthropic wire
 * corpus. The expected value is the byte length of the `messages` member that
 * today's builders wrote, recorded in the fixture; no builder runs here.
 */

import {
  caseOf,
  type FrozenFormat,
} from '../../../../../__tests__/support/frozenWire/frozenCases.js';
import type { FrozenFixture } from '../../../../../__tests__/support/frozenWire/frozenFixture.js';
import { analyze, lcg } from './lengthChecks.js';
import { frozenSettingsInputs } from './frozenInputs.js';
import type { PurgeEvidence } from './referenceFinish.js';
import { OutOfDomain } from './referenceTypes.js';

export interface LengthTally {
  cases: number;
  /** Seeds the model refuses: raw thinking chains that carry tool results. */
  outOfDomain: Array<{ seed: number; form: string }>;
  predictionMismatches: string[];
  referenceMismatches: string[];
  messageCountMismatches: string[];
  associativityChecks: number;
  associativityFailures: number;
  reachedStates: Set<number>;
  repaired: number;
  chained: number;
  lastKept: number;
  /** Controls: the wrong rule disagrees with the frozen length this often. */
  withoutOverlayWrong: number;
  oldSubstitutionWrong: number;
  oldSubstitutionRan: number;
  evidence: Record<'added' | 'reused' | 'none', number>;
}

export function newTally(): LengthTally {
  return {
    cases: 0,
    outOfDomain: [],
    predictionMismatches: [],
    referenceMismatches: [],
    messageCountMismatches: [],
    associativityChecks: 0,
    associativityFailures: 0,
    reachedStates: new Set(),
    repaired: 0,
    chained: 0,
    lastKept: 0,
    withoutOverlayWrong: 0,
    oldSubstitutionWrong: 0,
    oldSubstitutionRan: 0,
    evidence: { added: 0, reused: 0, none: 0 },
  };
}

function evidenceKey(evidence: PurgeEvidence): 'added' | 'reused' | 'none' {
  return evidence ?? 'none';
}

export async function checkSeed(
  format: FrozenFormat,
  fixture: FrozenFixture,
  seed: number,
  tally: LengthTally,
): Promise<void> {
  const frozen = await caseOf(format, seed);
  const member = fixture.cases[seed][4];
  const { wire, cache } = frozenSettingsInputs(frozen.settings);
  let analysis;
  try {
    analysis = analyze(frozen.rows, wire, cache, lcg(seed));
  } catch (error) {
    if (!(error instanceof OutOfDomain)) throw error;
    tally.outOfDomain.push({ seed, form: frozen.settings.form });
    return;
  }
  tally.cases += 1;
  if (analysis.predicted !== member) {
    tally.predictionMismatches.push(
      `seed ${seed}: predicted ${analysis.predicted}, frozen ${member}`,
    );
  }
  const reference = Buffer.byteLength(analysis.reference.json);
  if (reference !== member) {
    tally.referenceMismatches.push(
      `seed ${seed}: reference machine wrote ${reference}, frozen ${member}`,
    );
  }
  const written: unknown[] = JSON.parse(analysis.reference.json);
  const prefixMessages = cache.contextPrefix === undefined ? 0 : 1;
  if (analysis.predictedMessages + prefixMessages !== written.length) {
    tally.messageCountMismatches.push(`seed ${seed}`);
  }
  tally.associativityChecks += analysis.associativity.checks;
  tally.associativityFailures += analysis.associativity.failures;
  analysis.reached.forEach((state) => tally.reachedStates.add(state));
  if (analysis.repaired) tally.repaired += 1;
  if (analysis.chained) tally.chained += 1;
  if (analysis.lastKept) tally.lastKept += 1;
  if (analysis.withoutOverlay !== member) tally.withoutOverlayWrong += 1;
  if (analysis.oldSubstitution !== undefined) {
    tally.oldSubstitutionRan += 1;
    if (analysis.oldSubstitution !== member) tally.oldSubstitutionWrong += 1;
  }
  tally.evidence[evidenceKey(analysis.evidence)] += 1;
}
