/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gcAndSweep, heapSize } from 'bun:jsc';
import { z } from 'zod';
import {
  createWorkload,
  type Workload,
  type WorkloadMode,
} from './journal-retained-growth-workload.js';
import { SETTLE_NOISE_BYTES } from './journal-retained-growth-predicate.js';

/**
 * The settled heap is sampled on the same schedule for the whole run: after
 * every SAMPLE_EVERY_TURNS turns. A full sweep drops jettisoned code blocks
 * and the heap then refills as they are recompiled, so a window that follows a
 * long unsampled stretch would read lower than one that does not. Sampling
 * identically in warm-up, baseline and checkpoints keeps the regimes equal.
 * A checkpoint is the median of its last WINDOW_SAMPLES samples. The window
 * spans 45 turns because a periodic transient drops the settled heap by 1 to 3
 * MB for about 10 turns and then refills it; a median over a window several
 * times longer than the transient ignores it.
 */
const SAMPLE_EVERY_TURNS = 5;
const WINDOW_SAMPLES = 9;
/**
 * Warm-up runs until the settled heap has stopped moving. A fresh process
 * grows through startup, then drops sharply when startup garbage and code
 * blocks are collected, and measuring inside that settling hides or fakes
 * growth. Warm-up ends when each of the last CONVERGENCE_WINDOWS consecutive
 * windows of CONVERGENCE_WINDOW_SAMPLES samples differs from its predecessor by
 * less than the settle noise; the baseline is then the ordinary checkpoint
 * window ending there. A process that never settles fails the run. The trap
 * workloads start retaining only after this point, so every mode shares the
 * same warm-up.
 */
const CONVERGENCE_WINDOWS = 3;
const CONVERGENCE_WINDOW_SAMPLES = 3;
/**
 * Per-content measurements are a FIFO capped at DEFAULT_MAX_SENT_CALL_IDS
 * (2000) entries, and each turn measures about five new contents. The cache
 * therefore fills for the first ~400 to 500 turns and holds steady afterwards.
 * Warm-up runs past the cap so the measured window sees the full cache and
 * its constant size, not the bounded fill.
 */
const MIN_WARMUP_TURNS = 550;
const MAX_WARMUP_TURNS = 750;
/** Checkpoints sit at these distances after the converged baseline. */
const CHECKPOINT_OFFSETS = [100, 200, 300, 400] as const;
/** The release-trap lets go of its rows once this many checkpoints are taken. */
const RELEASE_AFTER_CHECKPOINTS = 3;
const SETTLE_ROUNDS = 6;

const modeSchema = z.enum(['normal', 'trap', 'release-trap']);

interface Sample {
  readonly turn: number;
  readonly heapBytes: number;
}

async function settledHeap(): Promise<number> {
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    await Bun.sleep(0);
    gcAndSweep();
  }
  return heapSize();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function runTurn(
  workload: Workload,
  turn: number,
  tokenTotals: number[],
): Promise<void> {
  await workload.runTurn(turn);
  await workload.history.waitForTokenUpdates();
  tokenTotals.push(workload.history.getTotalTokens());
}

/** Runs one turn and, on the sampling schedule, samples the settled heap. */
async function runSampledTurn(
  workload: Workload,
  turn: number,
  tokenTotals: number[],
  samples: Sample[],
): Promise<void> {
  await runTurn(workload, turn, tokenTotals);
  if (turn % SAMPLE_EVERY_TURNS !== 0) return;
  await workload.chat.waitForIdle();
  await workload.history.waitForCommit();
  samples.push({ turn, heapBytes: await settledHeap() });
}

/** The window of `size` samples ending at `endIndex`. */
function windowEndingAt(
  samples: readonly Sample[],
  endIndex: number,
  size: number = WINDOW_SAMPLES,
) {
  const window = samples.slice(endIndex - size + 1, endIndex + 1);
  return {
    turn: samples[endIndex].turn,
    heapBytes: median(window.map((sample) => sample.heapBytes)),
    readings: window.map((sample) => sample.heapBytes),
  };
}

function hasConverged(samples: readonly Sample[]): boolean {
  const size = CONVERGENCE_WINDOW_SAMPLES;
  if (samples.length < size * CONVERGENCE_WINDOWS) return false;
  const lastIndex = samples.length - 1;
  for (let step = 0; step < CONVERGENCE_WINDOWS - 1; step++) {
    const later = windowEndingAt(samples, lastIndex - step * size, size);
    const earlier = windowEndingAt(
      samples,
      lastIndex - (step + 1) * size,
      size,
    );
    if (Math.abs(later.heapBytes - earlier.heapBytes) >= SETTLE_NOISE_BYTES)
      return false;
  }
  return true;
}

/** Runs turns until the settled heap stops falling; returns the baseline. */
async function warmUp(
  workload: Workload,
  tokenTotals: number[],
  samples: Sample[],
) {
  for (let turn = 1; turn <= MAX_WARMUP_TURNS; turn++) {
    await runSampledTurn(workload, turn, tokenTotals, samples);
    const sampledNow = turn % SAMPLE_EVERY_TURNS === 0;
    const warmedPastCache = turn >= MIN_WARMUP_TURNS;
    if (sampledNow && warmedPastCache && hasConverged(samples))
      return windowEndingAt(samples, samples.length - 1);
  }
  throw new Error(
    `Settled heap kept falling through ${MAX_WARMUP_TURNS} warm-up turns: ${samples.map((sample) => `${sample.turn}:${sample.heapBytes}`).join(' ')}`,
  );
}

/** Runs turns up to `through` and returns the checkpoint window ending there. */
async function runToCheckpoint(
  workload: Workload,
  from: number,
  through: number,
  tokenTotals: number[],
) {
  const samples: Sample[] = [];
  for (let turn = from; turn <= through; turn++)
    await runSampledTurn(workload, turn, tokenTotals, samples);
  return windowEndingAt(samples, samples.length - 1);
}

/** Compression shows up as a history token total that falls between turns. */
function countCompressions(tokenTotals: readonly number[]): number {
  return tokenTotals.filter(
    (total, index) => index > 0 && total < tokenTotals[index - 1],
  ).length;
}

async function run(root: string, mode: WorkloadMode): Promise<void> {
  const workload = await createWorkload(root, mode);
  const tokenTotals: number[] = [];
  try {
    const warmup: Sample[] = [];
    const baseline = await warmUp(workload, tokenTotals, warmup);
    workload.startRetaining();
    const checkpoints = [];
    let completed = baseline.turn;
    for (const offset of CHECKPOINT_OFFSETS) {
      const target = baseline.turn + offset;
      checkpoints.push(
        await runToCheckpoint(workload, completed + 1, target, tokenTotals),
      );
      completed = target;
      if (
        mode === 'release-trap' &&
        checkpoints.length === RELEASE_AFTER_CHECKPOINTS
      )
        workload.releaseRetained();
    }
    const journalPath = workload.history.journalPath();
    writeFileSync(
      join(root, 'result.json'),
      JSON.stringify({
        mode,
        pid: process.pid,
        warmup,
        baseline,
        checkpoints,
        requests: workload.requestCount(),
        retainedRows: workload.retainedRows(),
        compressions: countCompressions(tokenTotals),
        maxHistoryTokens: Math.max(...tokenTotals),
        journalBytes: journalPath === null ? 0 : statSync(journalPath).size,
      }),
    );
  } finally {
    await workload.dispose();
  }
}

const root = z.string().min(1).parse(process.argv[2]);
await run(root, modeSchema.parse(process.argv[3]));
