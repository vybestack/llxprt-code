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
  hasConverged,
} from './support/journal-retained-growth-predicate.js';
import { CI_WARMUP_HEAP_READINGS } from './support/journal-retained-growth-ci-series.js';

/**
 * Method (authorized deviation): the measured window is 8 checkpoints, 100
 * turns apart. Every checkpoint must be under the 1 MiB allowance against the
 * original baseline. Accumulation is gated on the LAST half only (checkpoints
 * 4 to 8, fitted against their own start, plus the 4 to 8 endpoint growth),
 * each under SETTLE_NOISE_BYTES. JavaScriptCore lazy compile and tier-up add
 * bounded one-time steps at turns that vary by machine (CI saw one 220 KB step
 * then a flat run); a single fit over a short window failed on such a step. A
 * sustained leak of about 0.65 KB per turn or more still fails the late-window
 * gates, and a one-time step in the first half is bounded by the allowance.
 */
const CHECKPOINT_COUNT = 8;
const MEASURED_TURNS = CHECKPOINT_COUNT * 100;

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
type Result = z.infer<typeof resultSchema>;

async function runWorker(mode: Result['mode']): Promise<Result> {
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
  const warmup = result.warmup
    .map((sample) => `${sample.turn}:${sample.heapBytes}`)
    .join(' ');
  const samples = [result.baseline, ...result.checkpoints]
    .map((point) => `turn ${point.turn}: [${point.readings.join(', ')}]`)
    .join('\n');
  return `${result.mode} retained=${verdict.retainedBytes} deltas=${verdict.checkpointDeltas.join(',')} intervals=${verdict.intervalGrowth.join(',')} lateFitted=${Math.round(verdict.lateFittedGrowthBytes)} lateEndpoint=${verdict.lateEndpointGrowthBytes} requests=${result.requests} compressions=${result.compressions}\nwarmup ${warmup}\n${samples}`;
}

function expectRealWorkload(result: Result): void {
  const warmedTurn = result.baseline.turn;
  expect(result.requests).toBe(warmedTurn + MEASURED_TURNS);
  expect(result.compressions).toBeGreaterThanOrEqual(10);
  expect(result.journalBytes).toBeGreaterThan(0);
  expect(result.checkpoints.map((point) => point.turn)).toStrictEqual(
    Array.from(
      { length: CHECKPOINT_COUNT },
      (_, index) => warmedTurn + (index + 1) * 100,
    ),
  );
}

describe('repeated-turn retained growth over the real journal-backed send path', () => {
  // Separate child processes, so both heaps are measured independently and the
  // wall time is the slower run rather than the sum.
  let normalRun: Promise<Result>;
  let trapRun: Promise<Result>;
  let releaseTrapRun: Promise<Result>;
  beforeAll(() => {
    normalRun = runWorker('normal');
    trapRun = runWorker('trap');
    releaseTrapRun = runWorker('release-trap');
  });

  it('stays inside the allowance and does not accumulate with turn count', async () => {
    const result = await normalRun;
    process.stdout.write(`${report(result)}\n`);
    expectRealWorkload(result);
    expect(result.retainedRows).toBe(0);
    const verdict = evaluateRetainedGrowth(result.baseline, result.checkpoints);
    expect(verdict.failures).toStrictEqual([]);
    expect(verdict.pass).toBe(true);
    for (const delta of verdict.checkpointDeltas)
      expect(delta).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);

  it('trap: a test-installed observer keeping every request row fails the same predicate', async () => {
    const result = await trapRun;
    process.stdout.write(`${report(result)}\n`);
    expectRealWorkload(result);
    expect(result.retainedRows).toBeGreaterThan(400);
    const verdict = evaluateRetainedGrowth(result.baseline, result.checkpoints);
    expect(verdict.pass).toBe(false);
    // Fails every gate: the allowance, the late fit and the late endpoint.
    expect(
      verdict.failures.some((failure) => failure.includes('exceeds allowance')),
    ).toBe(true);
    expect(verdict.failures.some((failure) => failure.includes('fitted'))).toBe(
      true,
    );
    expect(
      verdict.failures.some((failure) => failure.includes('heap grew')),
    ).toBe(true);
    expect(verdict.retainedBytes).toBeGreaterThanOrEqual(
      RETAINED_ALLOWANCE_BYTES,
    );
  }, 300_000);

  it('trap: context retained between compressions and released before the last checkpoint fails', async () => {
    const result = await releaseTrapRun;
    process.stdout.write(`${report(result)}\n`);
    expectRealWorkload(result);
    // Retention was switched off and its rows dropped after the third
    // checkpoint (RELEASE_AFTER_CHECKPOINTS in the worker), so nothing is held
    // when the run ends.
    expect(result.retainedRows).toBe(0);
    const verdict = evaluateRetainedGrowth(result.baseline, result.checkpoints);
    // The release happens before the last checkpoint, so a final-delta-only
    // gate would pass this run. Only the per-checkpoint gate can fail it.
    expect(verdict.retainedBytes).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    expect(
      verdict.checkpointDeltas
        .slice(0, 3)
        .some((delta) => delta >= RETAINED_ALLOWANCE_BYTES),
    ).toBe(true);
    expect(
      verdict.failures.some((failure) => failure.includes('exceeds allowance')),
    ).toBe(true);
    expect(verdict.pass).toBe(false);
  }, 300_000);

  it('predicate rejects settled checkpoints above the allowance even when a later checkpoint is small', () => {
    const point = (turn: number, heapBytes: number) => ({ turn, heapBytes });
    const verdict = evaluateRetainedGrowth(point(40, 10_000_000), [
      point(100, 10_000_000),
      point(200, 11_500_000),
      point(300, 12_000_000),
      point(400, 10_700_000),
    ]);
    expect(verdict.retainedBytes).toBe(700_000);
    expect(verdict.pass).toBe(false);
    expect(verdict.checkpointDeltas).toStrictEqual([
      0, 1_500_000, 2_000_000, 700_000,
    ]);
    expect(verdict.failures.length).toBeGreaterThanOrEqual(2);
  });

  describe('late-window accumulation gate', () => {
    const BASE = 180_000_000;
    const point = (turn: number, heapBytes: number) => ({ turn, heapBytes });
    /** Eight checkpoints 100 turns apart; deltas are relative to BASE. */
    const evaluate = (deltas: readonly number[]) =>
      evaluateRetainedGrowth(
        point(1150, BASE),
        deltas.map((delta, index) =>
          point(1150 + (index + 1) * 100, BASE + delta),
        ),
      );
    const steady = (bytesPerTurn: number) =>
      Array.from({ length: 8 }, (_, index) => (index + 1) * 100 * bytesPerTurn);

    it('accepts the CI series (one 220 KB step, then flat) with a flat tail', () => {
      const verdict = evaluate([
        59_970, 279_441, 294_835, 245_080, 250_000, 247_000, 252_000, 249_000,
      ]);
      expect(verdict.failures).toStrictEqual([]);
      expect(verdict.pass).toBe(true);
    });

    it('rejects a steady leak of 1 KB per turn across all checkpoints', () => {
      const verdict = evaluate(steady(1_000));
      expect(verdict.pass).toBe(false);
      expect(verdict.retainedBytes).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    });

    it('rejects a steady leak of 0.7 KB per turn', () => {
      const verdict = evaluate(steady(700));
      expect(verdict.pass).toBe(false);
      expect(verdict.retainedBytes).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    });

    it('accepts a single 250 KB step in the first half with a flat tail', () => {
      const verdict = evaluate([
        0, 250_000, 250_000, 250_000, 250_000, 250_000, 250_000, 250_000,
      ]);
      expect(verdict.pass).toBe(true);
    });

    it('rejects a step in the second half combined with continued growth', () => {
      const verdict = evaluate([
        0, 0, 0, 0, 250_000, 350_000, 450_000, 550_000,
      ]);
      expect(verdict.pass).toBe(false);
    });

    it('accepts flat noise', () => {
      const verdict = evaluate([
        100_000, -100_000, 150_000, 0, 120_000, -80_000, 90_000, 30_000,
      ]);
      expect(verdict.pass).toBe(true);
    });

    it('rejects a first-half step that is above the allowance even when the tail is flat', () => {
      const verdict = evaluate([
        0,
        RETAINED_ALLOWANCE_BYTES + 1,
        RETAINED_ALLOWANCE_BYTES + 1,
        RETAINED_ALLOWANCE_BYTES + 1,
        RETAINED_ALLOWANCE_BYTES + 1,
        RETAINED_ALLOWANCE_BYTES + 1,
        RETAINED_ALLOWANCE_BYTES + 1,
        RETAINED_ALLOWANCE_BYTES + 1,
      ]);
      expect(verdict.pass).toBe(false);
    });
  });

  describe('warm-up convergence', () => {
    const SAMPLE_EVERY_TURNS = 5;
    const RULE_FLOOR_TURNS = 550;

    /** First sampled turn at or after turn 550 where the rule holds. */
    function firstConvergedTurn(readings: readonly number[]): number | null {
      for (let count = 1; count <= readings.length; count++) {
        const turn = count * SAMPLE_EVERY_TURNS;
        if (turn >= RULE_FLOOR_TURNS && hasConverged(readings.slice(0, count)))
          return turn;
      }
      return null;
    }

    it('converges on the CI series despite isolated dips, by turn 600', () => {
      const turn = firstConvergedTurn(CI_WARMUP_HEAP_READINGS);
      expect(turn).not.toBeNull();
      expect(turn).toBeLessThanOrEqual(600);
    });

    it('does not converge while the heap keeps rising', () => {
      const rising = Array.from(
        { length: 150 },
        (_, index) => 100_000_000 + index * 100_000,
      );
      expect(firstConvergedTurn(rising)).toBeNull();
    });

    it('does not converge on a slow climb whose neighbouring steps are each under the noise', () => {
      // Each window median moves 0.75x the noise from the last, 1.5x over three.
      const step = Math.floor((SETTLE_NOISE_BYTES * 0.75) / 9);
      const climbing = Array.from(
        { length: 150 },
        (_, index) => 100_000_000 + index * step,
      );
      expect(firstConvergedTurn(climbing)).toBeNull();
    });

    it('converges on a flat series with periodic dips', () => {
      const dipped = Array.from({ length: 150 }, (_, index) =>
        index % 13 === 6 ? 170_000_000 - 1_500_000 : 170_000_000,
      );
      expect(firstConvergedTurn(dipped)).toBe(RULE_FLOOR_TURNS);
    });

    it('needs three full windows of readings', () => {
      expect(hasConverged(Array(26).fill(170_000_000))).toBe(false);
      expect(hasConverged(Array(27).fill(170_000_000))).toBe(true);
    });
  });
});
