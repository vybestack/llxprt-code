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
import {
  WINDOW_SAMPLES,
  hasConverged,
  median,
} from './journal-retained-growth-predicate.js';

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
/**
 * Two bounded structures keep filling long after startup, and a baseline taken
 * before they finish reads low against every checkpoint.
 * (1) Per-content measurements are a FIFO capped at DEFAULT_MAX_SENT_CALL_IDS
 * (2000) entries at about five contents per turn, so the cache fills for the
 * first ~400 to 500 turns (a creep of about 270 KB between turns 550 and 650).
 * (2) JavaScriptCore compiles and tiers up function code blocks lazily. A
 * 1,750-turn run of this workload (settled heap, median of 9 samples, every 50
 * turns) rose in discrete steps, the last of about 170 KB at turns 1050 to
 * 1100, and then stayed at 180.58 MB +/- 0.06 MB through turn 1750. Object
 * counts from heapStats were flat from turn 700 to 1700 (Object +100 per 500
 * turns, which is the bench's own sample list) and the heap snapshot growth
 * between turns 1200 and 1700 was code blocks (+119 KB) plus strings (+13 KB).
 * That is bounded compiler state and not per-turn retention. Warm-up therefore
 * runs to at least turn 1150, so the measured window starts after the last
 * step and sees the structures at their constant size.
 */
const MIN_WARMUP_TURNS = 1150;
const MAX_WARMUP_TURNS = 1250;
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

/** The window of WINDOW_SAMPLES samples ending at `endIndex`. */
function windowEndingAt(samples: readonly Sample[], endIndex: number) {
  const window = samples.slice(endIndex - WINDOW_SAMPLES + 1, endIndex + 1);
  return {
    turn: samples[endIndex].turn,
    heapBytes: median(window.map((sample) => sample.heapBytes)),
    readings: window.map((sample) => sample.heapBytes),
  };
}

/**
 * Warm-up runs until the settled heap has stopped moving. A fresh process
 * grows through startup, then drops sharply when startup garbage and code
 * blocks are collected, and measuring inside that settling hides or fakes
 * growth. Warm-up ends when hasConverged holds over the checkpoint-sized
 * median windows; the baseline is then the ordinary checkpoint window ending
 * there. A process that never settles fails the run. The trap workloads start
 * retaining only after this point, so every mode shares the same warm-up.
 */
async function warmUp(
  workload: Workload,
  tokenTotals: number[],
  samples: Sample[],
) {
  for (let turn = 1; turn <= MAX_WARMUP_TURNS; turn++) {
    await runSampledTurn(workload, turn, tokenTotals, samples);
    const sampledNow = turn % SAMPLE_EVERY_TURNS === 0;
    const warmedPastCache = turn >= MIN_WARMUP_TURNS;
    if (
      sampledNow &&
      warmedPastCache &&
      hasConverged(samples.map((sample) => sample.heapBytes))
    )
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
