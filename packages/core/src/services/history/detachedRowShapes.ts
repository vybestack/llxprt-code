/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import type { IContent } from './IContent.js';

/** The rows of a detached candidate or of the history it was taken from, read in order. */
export type DetachedRows = Iterable<IContent> & { readonly length: number };

export interface TruncationCut {
  readonly itemsRemoved: number;
  readonly cutSeq: number | undefined;
}

/**
 * Detects a replacement that only drops the tail of the journal: every
 * replacement row equals the row at the same position. The tail then needs one
 * rewind rather than a rewind of everything plus a re-record of the kept rows.
 */
export function truncationCut(
  previous: DetachedRows,
  next: DetachedRows,
): TruncationCut | undefined {
  if (next.length === 0 || next.length >= previous.length) return undefined;
  const old: Iterator<IContent> = previous[Symbol.iterator]();
  try {
    for (const row of next) {
      const prior = old.next();
      if (prior.done === true || !isDeepStrictEqual(prior.value, row))
        return undefined;
    }
    const firstRemoved = old.next();
    const seq =
      firstRemoved.done === true
        ? undefined
        : firstRemoved.value.metadata?.chronology?.seq;
    return {
      itemsRemoved: previous.length - next.length,
      cutSeq: typeof seq === 'number' ? seq : undefined,
    };
  } finally {
    old.return?.();
  }
}

/** True when the replacement is value-identical to the journal, row for row. */
export function rowsUnchanged(
  previous: DetachedRows,
  next: DetachedRows,
): boolean {
  if (next.length !== previous.length) return false;
  const old: Iterator<IContent> = previous[Symbol.iterator]();
  try {
    for (const row of next) {
      const prior = old.next();
      if (prior.done === true || !isDeepStrictEqual(prior.value, row))
        return false;
    }
    return true;
  } finally {
    old.return?.();
  }
}
