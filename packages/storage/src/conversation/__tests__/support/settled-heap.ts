/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';

/**
 * Settled heap measurement for the request-artifact memory gate (issue #854).
 *
 * Mirrors packages/test-utils/src/core/settled-heap.ts. storage cannot depend
 * on test-utils because test-utils imports core and core depends on storage.
 */

/** Two consecutive settled readings closer than this count as converged. */
const SETTLED_WINDOW_BYTES = 64 * 1024;
/** Upper bound on settle rounds so a still-moving heap fails visibly. */
const MAX_SETTLE_ROUNDS = 12;

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Yield, run a full collection, and repeat until two consecutive heap
 * readings differ by no more than the window. When the heap never converges
 * inside the round bound the last reading is returned as is.
 */
export async function settledHeap(): Promise<number> {
  let previous = Number.NaN;
  let reading = Number.NaN;
  for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
    await yieldToEventLoop();
    gcAndSweep();
    reading = heapSize();
    if (Math.abs(reading - previous) <= SETTLED_WINDOW_BYTES) return reading;
    previous = reading;
  }
  return reading;
}

/** Median of a non-empty list of numbers (mean of the middle pair when even). */
export function median(values: readonly number[]): number {
  if (values.length === 0)
    throw new Error('median requires at least one value');
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
