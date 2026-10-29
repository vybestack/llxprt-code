/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** Id 0 is unowned and has no dictionary entry (design 5.1). */
export const UNOWNED = 0;

/**
 * Does the mirror of agent `mirrorOwner` hold a row that `rowOwner` owns? An
 * unowned row belongs to every agent, as `acceptsHistoryOrigin` says today
 * (design 5.2).
 */
export function accepts(mirrorOwner: number, rowOwner: number): boolean {
  return rowOwner === UNOWNED || rowOwner === mirrorOwner;
}

/**
 * The bit of the owner bloom an owner sets in an aggregate (design 2.5): the
 * owner id modulo 64. Two owners can share a bit, so a set bit only means
 * "maybe", and a clear one means the owner is not in the range.
 */
export function ownerBloomBit(owner: number): bigint {
  return 1n << BigInt(owner % 64);
}
