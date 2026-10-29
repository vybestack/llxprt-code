/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: provider-normalized membership facts. Whether a call has
 * a response (and a response a call) is a fact about the ids after the
 * provider's normalization, restricted to the sent range of units. Two raw ids
 * can normalize to one id (`''` and `call_` both become `call_`), so the raw
 * ids cannot answer it.
 *
 * `NormalizedIdIndex` is a STAND-IN for the on-disk index entries (the id trie
 * keyed by namespace and provider-normalized id, plus occurrence entries). A
 * query "is there an occurrence at or after unit u" reads the LAST occurrence
 * of the id: one trie lookup and one entry read. It is a heap map here and
 * stays test-only.
 */

import type { ResponsesUnit } from './responsesUnitFacts.js';

export class NormalizedIdIndex {
  private readonly calls = new Map<string, number[]>();
  private readonly responses = new Map<string, number[]>();
  /** Counts the lookups, to show queries are per id and never scans. */
  lookups = 0;

  static from(units: readonly ResponsesUnit[]): NormalizedIdIndex {
    const index = new NormalizedIdIndex();
    units.forEach((unit, ordinal) => {
      if (unit.speaker === 'ai') {
        for (const id of unit.callIds) index.add(index.calls, id, ordinal);
      }
      if (unit.speaker === 'tool') {
        for (const id of unit.responseIds) {
          index.add(index.responses, id, ordinal);
        }
      }
    });
    return index;
  }

  private add(
    entries: Map<string, number[]>,
    id: string,
    ordinal: number,
  ): void {
    entries.set(id, [...(entries.get(id) ?? []), ordinal]);
  }

  private lastAtOrAfter(
    entries: ReadonlyMap<string, readonly number[]>,
    id: string,
    from: number,
  ): boolean {
    this.lookups += 1;
    const ordinals = entries.get(id);
    return ordinals !== undefined && ordinals[ordinals.length - 1] >= from;
  }

  /** `ToolPairIndex.hasCall` over the sent range `[from, end)`. */
  hasCall(id: string, from: number): boolean {
    return this.lastAtOrAfter(this.calls, id, from);
  }

  /** `ToolPairIndex.hasResponse` over the sent range `[from, end)`. */
  hasResponse(id: string, from: number): boolean {
    return this.lastAtOrAfter(this.responses, id, from);
  }
}

/** The two membership tests of one unit's items. */
export interface PairPolicy {
  hasCall(normalizedId: string, rawId: string): boolean;
  hasResponse(normalizedId: string, rawId: string): boolean;
}

export function indexedPairs(
  index: NormalizedIdIndex,
  from: number,
): PairPolicy {
  return {
    hasCall: (id) => index.hasCall(id, from),
    hasResponse: (id) => index.hasResponse(id, from),
  };
}

/**
 * The control of design section 7.3: every response has a call, and every
 * call with a non-empty raw id has a response. It reads raw ids, so it is
 * wrong where two raw ids normalize to one.
 */
export const DESIGN_SHORTCUT_PAIRS: PairPolicy = {
  hasCall: () => true,
  hasResponse: (_normalizedId, rawId) => rawId !== '',
};
