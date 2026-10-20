/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { z } from 'zod';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import {
  CHECKPOINT_COUNT,
  CHECKPOINT_SPACING_TURNS,
  MEASURED_TURNS,
  MIN_COMPRESSIONS,
} from './journal-retained-growth-plan.js';
import { evaluateRetainedGrowth } from './journal-retained-growth-predicate.js';

/**
 * Per-test budget. The runner kills a whole test file at 300 s; each file
 * here waits for exactly one worker, so this stays under that ceiling.
 */
export const WORKER_TEST_TIMEOUT_MS = 290_000;

const checkpointSchema = z.object({
  turn: z.number(),
  heapBytes: z.number(),
  readings: z.array(z.number()),
});
const resultSchema = z.object({
  mode: z.enum(['normal', 'trap', 'release-trap']),
  warmup: z.array(z.object({ turn: z.number(), heapBytes: z.number() })),
  baseline: checkpointSchema,
  checkpoints: z.array(checkpointSchema).length(CHECKPOINT_COUNT),
  requests: z.number(),
  retainedRows: z.number(),
  compressions: z.number(),
  maxHistoryTokens: z.number(),
  journalBytes: z.number(),
});
export type RetainedGrowthResult = z.infer<typeof resultSchema>;

/** Runs one workload in its own child process and returns what it measured. */
export async function runWorker(
  mode: RetainedGrowthResult['mode'],
): Promise<RetainedGrowthResult> {
  const evidenceRoot = process.env['LLXPRT_RETAINED_EVIDENCE_ROOT'];
  const root = evidenceRoot
    ? mkdtempSync(join(evidenceRoot, `${mode}-`))
    : createScratchDirSync('journal-retained-growth-');
  process.stdout.write(`retained worker artifacts: ${root}\n`);
  const log = join(root, 'worker.log');
  const fd = openSync(log, 'w');
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'journal-retained-growth-worker.ts'),
      root,
      mode,
    ],
    {
      cwd: join(import.meta.dir, '../../../../..'),
      env: {
        ...process.env,
        TMPDIR: root,
        LLXPRT_CONFIG_HOME: join(root, 'config'),
        LLXPRT_DATA_HOME: join(root, 'data'),
        LLXPRT_CACHE_HOME: join(root, 'cache'),
        LLXPRT_LOG_HOME: join(root, 'logs'),
      },
      stdin: 'ignore',
      stdout: fd,
      stderr: fd,
    },
  );
  process.stdout.write(`retained worker pid: ${child.pid}\n`);
  const exit = await child.exited;
  closeSync(fd);
  if (exit !== 0)
    throw new Error(
      `Retained growth worker exit ${exit}: ${readFileSync(log, 'utf8')}`,
    );
  const result = resultSchema.parse(
    JSON.parse(readFileSync(join(root, 'result.json'), 'utf8')),
  );
  return result;
}

export function report(result: RetainedGrowthResult): string {
  const verdict = evaluateRetainedGrowth(result.baseline, result.checkpoints);
  const warmup = result.warmup
    .map((sample) => `${sample.turn}:${sample.heapBytes}`)
    .join(' ');
  const samples = [result.baseline, ...result.checkpoints]
    .map((point) => `turn ${point.turn}: [${point.readings.join(', ')}]`)
    .join('\n');
  return `${result.mode} retained=${verdict.retainedBytes} deltas=${verdict.checkpointDeltas.join(',')} intervals=${verdict.intervalGrowth.join(',')} lateFitted=${Math.round(verdict.lateFittedGrowthBytes)} lateEndpoint=${verdict.lateEndpointGrowthBytes} requests=${result.requests} compressions=${result.compressions}\nwarmup ${warmup}\n${samples}`;
}

/** The run really sent every turn, compressed repeatedly, and wrote a journal. */
export function expectRealWorkload(result: RetainedGrowthResult): void {
  const warmedTurn = result.baseline.turn;
  expect(result.requests).toBe(warmedTurn + MEASURED_TURNS);
  expect(result.compressions).toBeGreaterThanOrEqual(MIN_COMPRESSIONS);
  expect(result.journalBytes).toBeGreaterThan(0);
  expect(result.checkpoints.map((point) => point.turn)).toStrictEqual(
    Array.from(
      { length: CHECKPOINT_COUNT },
      (_, index) => warmedTurn + (index + 1) * CHECKPOINT_SPACING_TURNS,
    ),
  );
}
