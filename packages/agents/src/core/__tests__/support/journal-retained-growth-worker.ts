/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sourceApplicationHeap } from './source-application-heap.js';
import {
  createWorkload,
  type Workload,
  type WorkloadMode,
} from './journal-retained-growth-workload.js';
import {
  BASELINE_TURN,
  CENSUS_EVERY_TURNS,
  CENSUS_SAMPLES,
  CHECKPOINT_COUNT,
  CHECKPOINT_SPACING_TURNS,
  RELEASE_AFTER_CHECKPOINTS,
} from './journal-retained-growth-plan.js';
import { median } from './journal-retained-growth-predicate.js';

/**
 * Every reading is an application-heap census (source-application-heap.ts):
 * the bytes of a heap snapshot taken after a settled collection, minus the
 * compiled code block classes. The settled total heap is not used.
 * JavaScriptCore compiles, tiers up and discards function code blocks on its
 * own schedule; in an 800-turn census FunctionCodeBlock bytes moved by +3.4 MB
 * in one run and -1.2 MB in another between turns 200 and 800, while the
 * application classes moved by less than 40 KB. A warm-up that waits for the
 * total heap to stop moving therefore waits on the compiler, can absorb real
 * growth into its baseline, and need not end at all. The census leaves the
 * compiler out, so the fixed WARMUP_TURNS (see the plan) is the same for every
 * mode and waits on nothing.
 */
const BLOCK_TURNS = CENSUS_SAMPLES * CENSUS_EVERY_TURNS;
/** Checkpoints sit at these distances after the baseline. */
const CHECKPOINT_OFFSETS = Array.from(
  { length: CHECKPOINT_COUNT },
  (_, index) => (index + 1) * CHECKPOINT_SPACING_TURNS,
);

const modeSchema = z.enum(['normal', 'trap', 'release-trap']);

async function runTurn(
  workload: Workload,
  turn: number,
  tokenTotals: number[],
): Promise<void> {
  await workload.runTurn(turn);
  await workload.history.waitForTokenUpdates();
  tokenTotals.push(workload.history.getTotalTokens());
}

async function census(workload: Workload): Promise<number> {
  await workload.chat.waitForIdle();
  await workload.history.waitForCommit();
  return sourceApplicationHeap();
}

/**
 * Runs turns `from` to `through` and returns the checkpoint at `through`: the
 * median of CENSUS_SAMPLES censuses taken CENSUS_EVERY_TURNS apart, the last
 * one after turn `through`. One census can catch a send's transient objects;
 * the median of three does not.
 */
async function runToCheckpoint(
  workload: Workload,
  from: number,
  through: number,
  tokenTotals: number[],
) {
  const readings: number[] = [];
  for (let turn = from; turn <= through; turn++) {
    await runTurn(workload, turn, tokenTotals);
    const turnsBefore = through - turn;
    if (turnsBefore < BLOCK_TURNS && turnsBefore % CENSUS_EVERY_TURNS === 0)
      readings.push(await census(workload));
  }
  if (readings.length !== CENSUS_SAMPLES)
    throw new Error(
      `Checkpoint at turn ${through} took ${readings.length} censuses, expected ${CENSUS_SAMPLES}`,
    );
  return { turn: through, heapBytes: median(readings), readings };
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
    const baseline = await runToCheckpoint(
      workload,
      1,
      BASELINE_TURN,
      tokenTotals,
    );
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
