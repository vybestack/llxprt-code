/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the length checks of the Responses transducer. For one
 * unit stream and one send plan it builds the unit facts, resolves the pair
 * facts over the sent range, composes the per-unit summaries, and reports the
 * predicted byte length of the `input` array with the associativity and
 * coverage results. The caller compares the prediction with the bytes today's
 * builders wrote.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  checkAssociativity,
  leftFold,
  type AssociativityResult,
  type Monoid,
} from '../../../../__tests__/support/lengthModel/associativity.js';
import {
  DESIGN_SHORTCUT_PAIRS,
  NormalizedIdIndex,
  indexedPairs,
  type PairPolicy,
} from './normalizedIdIndex.js';
import {
  RESPONSES_IDENTITY,
  composeResponses,
  responsesLeaf,
  responsesTotalBytes,
  sameResponsesSummary,
  type ResponsesSummary,
} from './responsesTransducer.js';
import {
  responsesUnitFacts,
  type ResponsesSettings,
} from './responsesUnitFacts.js';

const RESPONSES_MONOID: Monoid<ResponsesSummary> = {
  identity: RESPONSES_IDENTITY,
  compose: composeResponses,
  same: sameResponsesSummary,
};

/** Which pair facts answer "has a response" and "has a call". */
export type PairRule = 'normalizedIds' | 'designShortcut';

export interface SendPlan {
  /** The first unit that is sent. */
  readonly cursor: number;
  /** Whether a previous response id is sent. */
  readonly serverSideParent: boolean;
  readonly pairRule: PairRule;
}

export const FULL_STATELESS_SEND: SendPlan = {
  cursor: 0,
  serverSideParent: false,
  pairRule: 'normalizedIds',
};

export interface ResponsesAnalysis {
  /** Predicted bytes of the `input` array. */
  readonly predicted: number;
  readonly items: number;
  /** Bytes of the `input_file` parts, against the aggregate limit. */
  readonly pdfBytes: number;
  readonly generatedIds: number;
  readonly associativity: AssociativityResult;
  readonly reachedStates: ReadonlySet<number>;
  readonly indexLookups: number;
}

function pairsOf(plan: SendPlan, index: NormalizedIdIndex): PairPolicy {
  return plan.pairRule === 'designShortcut'
    ? DESIGN_SHORTCUT_PAIRS
    : indexedPairs(index, plan.cursor);
}

export function analyzeResponses(
  units: readonly IContent[],
  settings: ResponsesSettings,
  plan: SendPlan,
  seed: number,
): ResponsesAnalysis {
  const facts = units.map((unit) => responsesUnitFacts(unit, settings));
  const index = NormalizedIdIndex.from(facts);
  const pairs = pairsOf(plan, index);
  const leaves = facts
    .slice(plan.cursor)
    .map((unit) => responsesLeaf(unit, plan.serverSideParent, pairs));
  const root = leftFold(RESPONSES_MONOID, leaves);
  const reachedStates = new Set<number>();
  let state = 0;
  for (const leaf of leaves) {
    state = leaf.out[state];
    reachedStates.add(state);
  }
  return {
    predicted: responsesTotalBytes(root, settings.reasoningIdTime),
    items: root.items[0],
    pdfBytes: root.pdfBytes,
    generatedIds: root.generatedIds,
    associativity: checkAssociativity(RESPONSES_MONOID, leaves, seed),
    reachedStates,
    indexLookups: index.lookups,
  };
}
