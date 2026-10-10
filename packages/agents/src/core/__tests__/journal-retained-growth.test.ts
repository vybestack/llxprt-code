/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { beforeAll, describe, expect, it } from 'bun:test';
import { closeSync, openSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import {
  RETAINED_ALLOWANCE_BYTES,
  SETTLE_NOISE_BYTES,
  evaluateRetainedGrowth,
} from './support/journal-retained-growth-predicate.js';

const checkpointSchema = z.object({
  turn: z.number(),
  heapBytes: z.number(),
  readings: z.array(z.number()),
});
const resultSchema = z.object({
  mode: z.enum(['normal', 'trap']),
  baseline: checkpointSchema,
  checkpoints: z.array(checkpointSchema).length(4),
  requests: z.number(),
  retainedRows: z.number(),
  compressions: z.number(),
  maxHistoryTokens: z.number(),
  journalBytes: z.number(),
});
type Result = z.infer<typeof resultSchema>;

async function runWorker(mode: 'normal' | 'trap'): Promise<Result> {
  const root = createScratchDirSync('journal-retained-growth-');
  const log = join(root, 'worker.log');
  const fd = openSync(log, 'w');
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'support/journal-retained-growth-worker.ts'),
      root,
      mode,
    ],
    {
      cwd: join(import.meta.dir, '../../../..'),
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
  const exit = await child.exited;
  closeSync(fd);
  if (exit !== 0)
    throw new Error(
      `Retained growth worker exit ${exit}: ${readFileSync(log, 'utf8')}`,
    );
  const result = resultSchema.parse(
    JSON.parse(readFileSync(join(root, 'result.json'), 'utf8')),
  );
  rmSync(root, { recursive: true, force: true });
  return result;
}

function report(result: Result): string {
  const verdict = evaluateRetainedGrowth(result.baseline, result.checkpoints);
  const samples = [result.baseline, ...result.checkpoints]
    .map((point) => `turn ${point.turn}: [${point.readings.join(', ')}]`)
    .join('\n');
  return `${result.mode} retained=${verdict.retainedBytes} intervals=${verdict.intervalGrowth.join(',')} requests=${result.requests} compressions=${result.compressions}\n${samples}`;
}

function expectRealWorkload(result: Result): void {
  expect(result.requests).toBe(400);
  expect(result.compressions).toBeGreaterThanOrEqual(10);
  expect(result.journalBytes).toBeGreaterThan(0);
  expect(result.checkpoints.map((point) => point.turn)).toStrictEqual([
    100, 200, 300, 400,
  ]);
}

describe('repeated-turn retained growth over the real journal-backed send path', () => {
  // Separate child processes, so both heaps are measured independently and the
  // wall time is the slower run rather than the sum.
  let normalRun: Promise<Result>;
  let trapRun: Promise<Result>;
  beforeAll(() => {
    normalRun = runWorker('normal');
    trapRun = runWorker('trap');
  });

  it('stays inside the allowance and does not accumulate with turn count', async () => {
    const result = await normalRun;
    process.stdout.write(`${report(result)}\n`);
    expectRealWorkload(result);
    expect(result.retainedRows).toBe(0);
    const verdict = evaluateRetainedGrowth(result.baseline, result.checkpoints);
    expect(verdict.failures).toStrictEqual([]);
    expect(verdict.pass).toBe(true);
  }, 300_000);

  it('trap: a test-installed observer keeping every request row fails the same predicate', async () => {
    const result = await trapRun;
    process.stdout.write(`${report(result)}\n`);
    expectRealWorkload(result);
    expect(result.retainedRows).toBeGreaterThan(400);
    const verdict = evaluateRetainedGrowth(result.baseline, result.checkpoints);
    expect(verdict.pass).toBe(false);
    expect(verdict.retainedBytes).toBeGreaterThanOrEqual(
      RETAINED_ALLOWANCE_BYTES,
    );
  }, 300_000);

  it('predicate rejects steady accumulation under the allowance and accepts flat noise', () => {
    const point = (turn: number, heapBytes: number) => ({ turn, heapBytes });
    const flat = evaluateRetainedGrowth(point(20, 50_000_000), [
      point(100, 50_100_000),
      point(200, 49_900_000),
      point(400, 50_150_000),
    ]);
    expect(flat.pass).toBe(true);
    const step = SETTLE_NOISE_BYTES + 1_000;
    const creeping = evaluateRetainedGrowth(point(20, 50_000_000), [
      point(100, 50_000_000 + step),
      point(200, 50_000_000 + 2 * step),
      point(400, 50_000_000 + 3 * step),
    ]);
    expect(creeping.pass).toBe(false);
    expect(creeping.retainedBytes).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
  });
});
