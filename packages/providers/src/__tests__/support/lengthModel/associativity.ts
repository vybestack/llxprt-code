/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the associativity check of a transfer-summary monoid.
 * Composing the summaries of a unit stream must give the same node whatever
 * the tree, so the check compares the left fold with the right fold, with a
 * random tree, and with the composition of the left and right folds at every
 * split point.
 */

import { lcg } from './bytes.js';

export interface Monoid<S> {
  readonly identity: S;
  readonly compose: (left: S, right: S) => S;
  readonly same: (left: S, right: S) => boolean;
}

export interface AssociativityResult {
  checks: number;
  failures: number;
}

export function leftFold<S>(
  monoid: Monoid<S>,
  leaves: readonly S[],
  low = 0,
  high = leaves.length,
): S {
  let accumulated = monoid.identity;
  for (let at = low; at < high; at += 1) {
    accumulated = monoid.compose(accumulated, leaves[at]);
  }
  return accumulated;
}

function randomTree<S>(
  monoid: Monoid<S>,
  leaves: readonly S[],
  low: number,
  high: number,
  random: () => number,
): S {
  if (high - low === 0) return monoid.identity;
  if (high - low === 1) return leaves[low];
  const mid = low + 1 + Math.floor(random() * (high - low - 1));
  return monoid.compose(
    randomTree(monoid, leaves, low, mid, random),
    randomTree(monoid, leaves, mid, high, random),
  );
}

/** `suffixes[at]` folds `leaves[at ..]` from the right. */
function rightFolds<S>(monoid: Monoid<S>, leaves: readonly S[]): S[] {
  const suffixes: S[] = new Array(leaves.length + 1);
  suffixes[leaves.length] = monoid.identity;
  for (let at = leaves.length - 1; at >= 0; at -= 1) {
    suffixes[at] = monoid.compose(leaves[at], suffixes[at + 1]);
  }
  return suffixes;
}

/**
 * Checks one leaf sequence. Every split `prefix(at) . suffix(at)` must equal
 * the whole, and the right fold and one random tree must agree with the left
 * fold. `seed` fixes the random tree.
 */
export function checkAssociativity<S>(
  monoid: Monoid<S>,
  leaves: readonly S[],
  seed: number,
): AssociativityResult {
  const whole = leftFold(monoid, leaves);
  const suffixes = rightFolds(monoid, leaves);
  const result: AssociativityResult = { checks: 2, failures: 0 };
  if (!monoid.same(whole, suffixes[0])) result.failures += 1;
  const tree = randomTree(monoid, leaves, 0, leaves.length, lcg(seed));
  if (!monoid.same(whole, tree)) result.failures += 1;
  let prefix = monoid.identity;
  for (let at = 0; at <= leaves.length; at += 1) {
    result.checks += 1;
    if (!monoid.same(whole, monoid.compose(prefix, suffixes[at]))) {
      result.failures += 1;
    }
    if (at < leaves.length) prefix = monoid.compose(prefix, leaves[at]);
  }
  return result;
}
