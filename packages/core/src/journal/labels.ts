/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';

/** Labels are 64-bit order keys, 1-based so that 0 means none (design 2.6). */
const LABEL_LIMIT = 1n << 64n;

/** The gap between the labels of consecutive appends. */
export const LABEL_STEP = 1n << 20n;

/** The first `nextLabel` of a new journal: room below the first row for a compression summary. */
export const FIRST_NEXT_LABEL = LABEL_STEP;

export interface AppendLabels {
  readonly labels: readonly bigint[];
  /** The trailer's new `nextLabel`; it only grows. */
  readonly nextLabel: bigint;
}

/** `label = nextLabel; nextLabel += 2^20`, once for each row. */
export function allocateAppendLabels(
  nextLabel: bigint,
  rowCount: number,
): AppendLabels {
  const labels: bigint[] = [];
  let next = nextLabel;
  for (let row = 0; row < rowCount; row++) {
    if (next + LABEL_STEP >= LABEL_LIMIT) {
      throw new JournalFormatError(
        `Label ${next} leaves no room for another row below 2^64`,
      );
    }
    labels.push(next);
    next += LABEL_STEP;
  }
  return { labels, nextLabel: next };
}

/**
 * The midpoint between two live neighbours for a synthetic insert, or
 * undefined when there is none and the mutation has to relabel the affected
 * run inside its group (design 4.6).
 */
export function labelBetween(lower: bigint, upper: bigint): bigint | undefined {
  if (lower > upper) {
    throw new JournalFormatError(
      `Labels out of order: ${lower} is above ${upper}`,
    );
  }
  if (upper - lower < 2n) return undefined;
  return lower + (upper - lower) / 2n;
}

/** The summary of a compression goes just below the first retained row, or at `nextLabel` when nothing is retained. */
export function compressionLabel(
  firstRetained: bigint | undefined,
  nextLabel: bigint,
): bigint {
  if (firstRetained === undefined) return nextLabel;
  if (firstRetained < 2n) {
    throw new JournalFormatError(
      `First retained label ${firstRetained} leaves no label below it`,
    );
  }
  return firstRetained - 1n;
}
