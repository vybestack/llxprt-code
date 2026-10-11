/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';

/**
 * Shared measurement methods for heap and owner gates (issue #854).
 *
 * Single heap readings carry a few hundred KiB of allocator and JSC code-block
 * jitter. These helpers keep that jitter out of fixed bounds by settling the
 * heap before every reading and by taking medians across repeated runs. They
 * never widen a bound and never drop a reading: a real retention shows up in
 * every run and survives the median.
 */

/** Two consecutive settled readings closer than this count as converged. */
export const SETTLED_WINDOW_BYTES = 64 * 1024;
/** Upper bound on settle rounds so a still-moving heap fails visibly. */
export const MAX_SETTLE_ROUNDS = 12;

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

export interface SettledHeapOptions {
  windowBytes?: number;
  maxRounds?: number;
}

/**
 * Yield to the event loop, run a synchronous full collection, and repeat until
 * two consecutive heap readings differ by no more than the window. Returns the
 * last reading; when the heap never converges inside the round bound the last
 * reading is returned as is, so unexplained movement stays visible.
 */
export async function settledHeap(
  options: SettledHeapOptions = {},
): Promise<number> {
  const windowBytes = options.windowBytes ?? SETTLED_WINDOW_BYTES;
  const maxRounds = options.maxRounds ?? MAX_SETTLE_ROUNDS;
  let previous = Number.NaN;
  let reading = Number.NaN;
  for (let round = 0; round < maxRounds; round++) {
    await yieldToEventLoop();
    gcAndSweep();
    reading = heapSize();
    if (Math.abs(reading - previous) <= windowBytes) return reading;
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

/**
 * Run `runOnce` once unmeasured so one-time state (JIT, code blocks, lazy
 * encoders, WASM growth) exists, then run it `n` times and return the median
 * of the settled heap growth of each run (settled after minus settled before).
 */
export async function medianSettledDelta(
  runOnce: () => Promise<void>,
  n = 3,
): Promise<number> {
  await runOnce();
  const deltas: number[] = [];
  for (let run = 0; run < n; run++) {
    const before = await settledHeap();
    await runOnce();
    deltas.push((await settledHeap()) - before);
  }
  return median(deltas);
}

/**
 * Median over `n` measured runs after one unmeasured warm run, where each run
 * reports its own delta (for gates that read in-flight checkpoints inside the
 * run rather than a single settled delta around it).
 */
export async function medianOfRuns(
  measure: () => Promise<number>,
  n = 3,
): Promise<number> {
  await measure();
  const deltas: number[] = [];
  for (let run = 0; run < n; run++) deltas.push(await measure());
  return median(deltas);
}

/**
 * Bounded GC poll for WeakRef ownership checks: yield, sweep, and look again
 * for up to `maxRounds` rounds. True when the target was collected.
 */
export async function collectedWithin(
  ref: WeakRef<object>,
  maxRounds = MAX_SETTLE_ROUNDS,
): Promise<boolean> {
  for (let round = 0; round < maxRounds; round++) {
    if (ref.deref() === undefined) return true;
    await yieldToEventLoop();
    gcAndSweep();
  }
  return ref.deref() === undefined;
}
