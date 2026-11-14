/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the length checks of the Anthropic transducer. For one
 * history and one format key it builds the unit facts, runs the reference
 * machine (which records the validators' decisions as overlays), composes the
 * per-unit summaries, and reports the predicted length of the `messages`
 * array together with the associativity, closure and control results. The
 * caller compares the prediction with the bytes today's builders wrote.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { WireSettings } from '../wireBuilderHarness.js';
import {
  referenceRun,
  type CacheOpts,
  type PurgeEvidence,
  type ReferenceRun,
} from './referenceFinish.js';
import { emptyOverlay, type Overlay, type Policy } from './referenceTypes.js';
import {
  IDENTITY,
  STATES,
  START,
  compose,
  finalize,
  indexOf,
  leaf,
  sameSummary,
  step,
  unitSteps,
  type Final,
  type Summary,
} from './transducer.js';
import { unitFacts, type UnitFact } from './unitFacts.js';

export function policyOf(settings: WireSettings): Policy {
  return {
    reasoningEnabled: settings.reasoningEnabled,
    includeInContext: settings.includeInContext,
    strip: settings.strip,
  };
}

export function lcg(seed: number): () => number {
  const start = seed >>> 0;
  let state = start === 0 ? 1 : start;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export type Combine = (
  leaves: readonly Summary[],
  lo: number,
  hi: number,
) => Summary;

export function composeFold(
  leaves: readonly Summary[],
  lo: number,
  hi: number,
): Summary {
  let acc = IDENTITY;
  for (let at = lo; at < hi; at += 1) acc = compose(acc, leaves[at]);
  return acc;
}

export function composeRandom(
  leaves: readonly Summary[],
  lo: number,
  hi: number,
  random: () => number,
): Summary {
  if (hi - lo === 0) return IDENTITY;
  if (hi - lo === 1) return leaves[lo];
  const mid = lo + 1 + Math.floor(random() * (hi - lo - 1));
  return compose(
    composeRandom(leaves, lo, mid, random),
    composeRandom(leaves, mid, hi, random),
  );
}

export interface Leaves {
  /** Per unit, thinking kept. */
  K: Summary[];
  /** Per unit, thinking redacted. */
  R: Summary[];
}

export function leavesOf(
  units: readonly UnitFact[],
  overlay: readonly Overlay[],
): Leaves {
  return {
    K: units.map((unit) => leaf(unit, unitSteps(unit, 0, overlay[unit.index]))),
    R: units.map((unit) => leaf(unit, unitSteps(unit, 1, overlay[unit.index]))),
  };
}

/** Last unit of the group that starts at `start` (a chain spans AI units). */
function groupEnd(units: readonly UnitFact[], start: number): number {
  if (!units[start].chainStart) return start;
  let end = start;
  while (end + 1 < units.length && units[end + 1].speaker === 'ai') end += 1;
  return end;
}

/**
 * Which stored variant each unit reads under a thinking policy: the whole
 * stream redacted, kept, or `allButLast` (the last group that holds thinking
 * keeps it, every unit of a chain group included).
 */
export function policySummary(
  units: readonly UnitFact[],
  leaves: Leaves,
  policy: Policy,
  combine: Combine,
): Summary {
  const count = units.length;
  const redactAll = policy.includeInContext === false || policy.strip === 'all';
  if (redactAll) return combine(leaves.R, 0, count);
  if (policy.strip !== 'allButLast') return combine(leaves.K, 0, count);
  const start = combine(leaves.K, 0, count).lastL[0];
  if (start < 0) return combine(leaves.R, 0, count);
  const end = groupEnd(units, start);
  return compose(
    compose(combine(leaves.R, 0, start), combine(leaves.K, start, end + 1)),
    combine(leaves.R, end + 1, count),
  );
}

/** The wrong rule of the first design: only the first unit of the group keeps thinking. */
export function oldSingleUnitSubstitution(
  units: readonly UnitFact[],
  leaves: Leaves,
  policy: Policy,
): Summary | undefined {
  if (policy.strip !== 'allButLast' || policy.includeInContext === false) {
    return undefined;
  }
  const start = composeFold(leaves.K, 0, units.length).lastL[0];
  if (start < 0) return undefined;
  return compose(
    compose(
      composeFold(leaves.R, 0, start),
      composeFold(leaves.K, start, start + 1),
    ),
    composeFold(leaves.R, start + 1, units.length),
  );
}

/** The state sequence of the sequential run; a step outside the proved set throws. */
export function reachedStates(
  units: readonly UnitFact[],
  overlay: readonly Overlay[],
): number[] {
  const reached: number[] = [];
  let state = START;
  for (const unit of units) {
    const result = step(STATES[state], unitSteps(unit, 0, overlay[unit.index]));
    state = indexOf(result.st);
    reached.push(state);
  }
  return reached;
}

export interface Associativity {
  checks: number;
  failures: number;
}

/**
 * Composition in tree order equals the sequential run: at every split point
 * (a left fold of the prefix against a right fold of the suffix) and on one
 * random tree shape per variant.
 */
export function associativity(
  leaves: Leaves,
  random: () => number,
): Associativity {
  const result: Associativity = { checks: 0, failures: 0 };
  for (const variant of [leaves.K, leaves.R]) {
    const count = variant.length;
    const prefix: Summary[] = [IDENTITY];
    for (let at = 0; at < count; at += 1) {
      prefix.push(compose(prefix[at], variant[at]));
    }
    const suffix: Summary[] = Array.from({ length: count + 1 }, () => IDENTITY);
    for (let at = count - 1; at >= 0; at -= 1) {
      suffix[at] = compose(variant[at], suffix[at + 1]);
    }
    for (let split = 0; split <= count; split += 1) {
      result.checks += 1;
      if (!sameSummary(prefix[count], compose(prefix[split], suffix[split]))) {
        result.failures += 1;
      }
    }
    result.checks += 1;
    if (!sameSummary(prefix[count], composeRandom(variant, 0, count, random))) {
      result.failures += 1;
    }
  }
  return result;
}

export interface Analysis {
  /** Predicted byte length of the `messages` array. */
  predicted: number;
  /** Predicted message count (cache prefix excluded). */
  predictedMessages: number;
  reference: ReferenceRun;
  associativity: Associativity;
  reached: number[];
  /** Length predicted when the repair overlay is ignored. */
  withoutOverlay: number;
  /** Length predicted by the first design's single-unit last-kept rule. */
  oldSubstitution: number | undefined;
  repaired: boolean;
  chained: boolean;
  lastKept: boolean;
  evidence: PurgeEvidence;
}

export function analyze(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheOpts,
  random: () => number,
): Analysis {
  const units = unitFacts(rows, settings);
  const policy = policyOf(settings);
  const reference = referenceRun(units, policy, settings, cache);
  const leaves = leavesOf(units, reference.overlay);
  const finishing = {
    reasoningEnabled: settings.reasoningEnabled,
    currentModel: settings.currentModel,
  };
  const final: Final = finalize(
    policySummary(units, leaves, policy, composeFold),
    finishing,
  );
  const bare = leavesOf(units, units.map(emptyOverlay));
  const withoutOverlay = finalize(
    policySummary(units, bare, policy, composeFold),
    finishing,
  );
  const substituted = oldSingleUnitSubstitution(units, leaves, policy);
  return {
    predicted: final.length + reference.cacheDelta,
    predictedMessages: final.messages,
    reference,
    associativity: associativity(leaves, random),
    reached: reachedStates(units, reference.overlay),
    withoutOverlay: withoutOverlay.length + reference.cacheDelta,
    oldSubstitution:
      substituted === undefined
        ? undefined
        : finalize(substituted, finishing).length + reference.cacheDelta,
    repaired: reference.repaired,
    chained: reference.asm.chainContext.some(Boolean),
    lastKept:
      policy.strip === 'allButLast' &&
      policy.includeInContext !== false &&
      units.some((unit) => unit.hasThinking),
    evidence: reference.evidence,
  };
}

/**
 * The summary of the first design: counts of runs, roles, blocks and string
 * bytes. Two histories with equal fields can write different lengths (the
 * twelve-row pair of the review writes 411 and 461 bytes), so a model built
 * on it is wrong.
 */
export function oldMonoidFields(units: readonly UnitFact[]): {
  blockBytes: number;
  blocks: number;
  runs: number;
  human: number;
  ai: number;
  first: string;
  last: string;
} {
  let blockBytes = 0;
  let blocks = 0;
  for (const unit of units) {
    for (const atom of unit.atoms[0]) {
      blocks += 1;
      blockBytes += atom.str?.bytes ?? 0;
    }
  }
  const roles = units.map((unit) => unit.speaker);
  let runs = roles.length === 0 ? 0 : 1;
  for (let at = 1; at < roles.length; at += 1) {
    if (roles[at] !== roles[at - 1]) runs += 1;
  }
  const human = roles.filter((role) => role === 'human').length;
  return {
    blockBytes,
    blocks,
    runs,
    human,
    ai: roles.length - human,
    first: roles[0],
    last: roles[roles.length - 1],
  };
}
