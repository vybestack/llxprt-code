/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { heapSize } from 'bun:jsc';
import { z } from 'zod';
import {
  createWorkload,
  type Workload,
  type WorkloadMode,
} from './journal-retained-growth-workload.js';

/** Turns run before the baseline window so first compression and journal are warm. */
const WARMUP_TURNS = 40;
const CHECKPOINT_TURNS = [80, 120, 200] as const;
/**
 * A checkpoint is the median of settled readings taken after each of the last
 * turns before it. Settled heap alternates between GC generations from turn to
 * turn, so consecutive turns are sampled instead of repeating one turn.
 */
const WINDOW_TURNS = 5;
const SETTLE_ROUNDS = 6;

const modeSchema = z.enum(['normal', 'trap']);

async function settledHeap(): Promise<number> {
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    await Bun.sleep(0);
    Bun.gc(true);
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

/**
 * Runs turns up to `through` and samples the settled heap after each of the
 * last WINDOW_TURNS. Turn locals die when each turn returns, so nothing
 * test-owned survives to a sample.
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
    if (turn > through - WINDOW_TURNS) {
      await workload.chat.waitForIdle();
      await workload.history.waitForCommit();
      readings.push(await settledHeap());
    }
  }
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
      WARMUP_TURNS,
      tokenTotals,
    );
    const checkpoints = [];
    let completed = WARMUP_TURNS;
    for (const target of CHECKPOINT_TURNS) {
      checkpoints.push(
        await runToCheckpoint(workload, completed + 1, target, tokenTotals),
      );
      completed = target;
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
