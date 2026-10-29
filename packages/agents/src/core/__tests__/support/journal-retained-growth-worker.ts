/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  createWorkload,
  type Workload,
  type WorkloadMode,
} from './journal-retained-growth-workload.js';
import {
  CHECKPOINT_COUNT,
  CHECKPOINT_SPACING_TURNS,
  RELEASE_AFTER_CHECKPOINTS,
} from './journal-retained-growth-plan.js';
import {
  CHECKPOINT_SAMPLE_EVERY_TURNS,
  CONVERGENCE_WINDOWS,
  CONVERGENCE_WINDOW_SAMPLES,
  WARMUP_SAMPLE_EVERY_TURNS,
  WINDOW_SAMPLES,
  hasConverged,
  median,
} from './journal-retained-growth-predicate.js';

/**
 * The settled heap is sampled only where a reading is used. A checkpoint (and
 * the baseline) is the median of the WINDOW_SAMPLES samples taken
 * CHECKPOINT_SAMPLE_EVERY_TURNS apart over the BLOCK_TURNS turns before it;
 * nothing is sampled between blocks. The window spans 45 turns because a
 * periodic transient drops the settled heap by 1 to 3 MB for about 10 turns
 * and then refills it; a median over a window several times longer than the
 * transient ignores it. Each reading is a full collection of a heap of about
 * 170 MB, so reading only where a reading is used keeps the run inside the
 * per-file budget.
 */
const BLOCK_TURNS = WINDOW_SAMPLES * CHECKPOINT_SAMPLE_EVERY_TURNS;
/**
 * The normal run warms up until the settled heap has converged. Two bounded
 * structures keep filling after startup, and a baseline taken before they
 * finish reads low against every checkpoint.
 * (1) Per-content measurements are a FIFO capped at DEFAULT_MAX_SENT_CALL_IDS
 * (2000) entries, filled a few entries per turn.
 * (2) JavaScriptCore compiles and tiers up function code blocks lazily, in
 * discrete bounded steps. Object counts from heapStats were flat afterwards
 * and the heap snapshot growth between turns was code blocks and strings, so
 * this is bounded compiler state and not per-turn retention.
 * MIN_WARMUP_TURNS and MAX_WARMUP_TURNS bracket where the 4 KB-row workload
 * converges (see heap-inventory.md).
 */
const MIN_WARMUP_TURNS = 500;
const MAX_WARMUP_TURNS = 650;
/**
 * The traps measure gross retention (many MB over the window), which dwarfs
 * compiler warm-up steps of a few hundred KB, so they need no converged
 * baseline. A short fixed warm-up gets past process startup. It must also get
 * past the per-content measurement FIFO fill (about 500 turns): the release
 * trap's final reading is compared with this baseline, and a baseline taken
 * before the fill left about 950 KB of that fill in the final delta.
 */
const TRAP_WARMUP_TURNS = 550;
/** Checkpoints sit at these distances after the baseline. */
const CHECKPOINT_OFFSETS = Array.from(
  { length: CHECKPOINT_COUNT },
  (_, index) => (index + 1) * CHECKPOINT_SPACING_TURNS,
);

const modeSchema = z.enum(['normal', 'trap', 'release-trap']);

interface Sample {
  readonly turn: number;
  readonly heapBytes: number;
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

async function sampleSettled(
  workload: Workload,
  turn: number,
): Promise<Sample> {
  await workload.chat.waitForIdle();
  await workload.history.waitForCommit();
  return { turn, heapBytes: await settledHeap() };
}

/** Median of the settled samples taken in the block of turns ending at `turn`. */
function windowOf(turn: number, samples: readonly Sample[]) {
  return {
    turn,
    heapBytes: median(samples.map((sample) => sample.heapBytes)),
    readings: samples.map((sample) => sample.heapBytes),
  };
}

/**
 * Runs turns `from` to `through` and returns the checkpoint window ending at
 * `through`. Only the last BLOCK_TURNS turns are sampled, every
 * CHECKPOINT_SAMPLE_EVERY_TURNS, so the window holds exactly WINDOW_SAMPLES.
 */
async function runToCheckpoint(
  workload: Workload,
  from: number,
  through: number,
  tokenTotals: number[],
) {
  const samples: Sample[] = [];
  for (let turn = from; turn <= through; turn++) {
    await runTurn(workload, turn, tokenTotals);
    const turnsBefore = through - turn;
    if (
      turnsBefore < BLOCK_TURNS &&
      turnsBefore % CHECKPOINT_SAMPLE_EVERY_TURNS === 0
    )
      samples.push(await sampleSettled(workload, turn));
  }
  return windowOf(through, samples);
}

/**
 * Warm-up runs until the settled heap has stopped moving. A fresh process
 * grows through startup, then drops sharply when startup garbage and code
 * blocks are collected, and measuring inside that settling hides or fakes
 * growth. Samples start CONVERGENCE_WINDOWS full windows before
 * MIN_WARMUP_TURNS, since the rule cannot hold with fewer readings. Warm-up
 * ends when hasConverged holds; the baseline is then an ordinary checkpoint
 * window over the turns that follow. A process that never settles fails the
 * run.
 */
async function warmUp(
  workload: Workload,
  tokenTotals: number[],
  samples: Sample[],
) {
  const firstSampleTurn =
    MIN_WARMUP_TURNS -
    (CONVERGENCE_WINDOWS * CONVERGENCE_WINDOW_SAMPLES - 1) *
      WARMUP_SAMPLE_EVERY_TURNS;
  for (let turn = 1; turn <= MAX_WARMUP_TURNS; turn++) {
    await runTurn(workload, turn, tokenTotals);
    if (turn < firstSampleTurn || turn % WARMUP_SAMPLE_EVERY_TURNS !== 0)
      continue;
    samples.push(await sampleSettled(workload, turn));
    if (hasConverged(samples.map((sample) => sample.heapBytes)))
      return runToCheckpoint(
        workload,
        turn + 1,
        turn + BLOCK_TURNS,
        tokenTotals,
      );
  }
  throw new Error(
    `Settled heap kept falling through ${MAX_WARMUP_TURNS} warm-up turns: ${samples.map((sample) => `${sample.turn}:${sample.heapBytes}`).join(' ')}`,
  );
}

/** Fixed short warm-up for the traps; the baseline ends at TRAP_WARMUP_TURNS. */
function warmUpFixed(workload: Workload, tokenTotals: number[]) {
  return runToCheckpoint(workload, 1, TRAP_WARMUP_TURNS, tokenTotals);
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
    const baseline =
      mode === 'normal'
        ? await warmUp(workload, tokenTotals, warmup)
        : await warmUpFixed(workload, tokenTotals);
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
