/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  CONVERGENCE_WINDOW_SAMPLES,
  CONVERGENCE_WINDOWS,
  RETAINED_ALLOWANCE_BYTES,
  SETTLE_NOISE_BYTES,
  WARMUP_SAMPLE_EVERY_TURNS,
  evaluateRetainedGrowth,
  hasConverged,
} from './support/journal-retained-growth-predicate.js';
import { CI_WARMUP_HEAP_READINGS } from './support/journal-retained-growth-ci-series.js';
import {
  CHECKPOINT_COUNT,
  CHECKPOINT_SPACING_TURNS,
  ROW_BYTES,
} from './support/journal-retained-growth-plan.js';
import {
  WORKER_TEST_TIMEOUT_MS,
  expectRealWorkload,
  report,
  runWorker,
} from './support/journal-retained-growth-harness.js';

/**
 * Method (authorized deviation): the measured window is 6 checkpoints, 50
 * turns apart, after a converged warm-up. Every checkpoint must be under the
 * 1 MiB allowance against the original baseline. Accumulation is gated on
 * checkpoints 3 to 6 only, fitted against their own start, plus the 3 to 6
 * endpoint growth, each under SETTLE_NOISE_BYTES (262,144 B). JavaScriptCore
 * lazy compile and tier-up add bounded one-time steps at turns that vary by
 * machine; a single fit over a short window failed on such a step.
 *
 * Sensitivity is set relative to the turn content. Each turn adds a user
 * message and a model reply of about ROW_BYTES (4 KB) each, and the allowance
 * is crossed by a leaked row per turn in about 250 turns. The late gate spans
 * 150 turns, so 262,144 B is about 1.7 KB per turn, roughly 0.4 of one row per
 * turn: retention of well under one row per turn fails it, and far tighter
 * relative to turn content than the earlier 0.65 KB per turn gate on rows of a
 * few hundred bytes. The retaining and release traps live in
 * their own files, each with its own worker process and time budget.
 */

describe('repeated-turn retained growth over the real journal-backed send path', () => {
  it(
    'stays inside the allowance and does not accumulate with turn count',
    async () => {
      const result = await runWorker('normal');
      process.stdout.write(`${report(result)}\n`);
      expectRealWorkload(result);
      expect(result.retainedRows).toBe(0);
      const verdict = evaluateRetainedGrowth(
        result.baseline,
        result.checkpoints,
      );
      expect(verdict.failures).toStrictEqual([]);
      expect(verdict.pass).toBe(true);
      for (const delta of verdict.checkpointDeltas)
        expect(delta).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    },
    WORKER_TEST_TIMEOUT_MS,
  );

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
    /** Checkpoints 50 turns apart; deltas are relative to BASE. */
    const evaluate = (deltas: readonly number[]) =>
      evaluateRetainedGrowth(
        point(400, BASE),
        deltas.map((delta, index) =>
          point(400 + (index + 1) * CHECKPOINT_SPACING_TURNS, BASE + delta),
        ),
      );
    const steady = (bytesPerTurn: number) =>
      Array.from(
        { length: CHECKPOINT_COUNT },
        (_, index) => (index + 1) * CHECKPOINT_SPACING_TURNS * bytesPerTurn,
      );

    it('accepts the CI series (one 220 KB step, then flat) with a flat tail', () => {
      const verdict = evaluate([
        59_970, 279_441, 294_835, 245_080, 250_000, 247_000,
      ]);
      expect(verdict.failures).toStrictEqual([]);
      expect(verdict.pass).toBe(true);
    });

    it('rejects a steady leak of 2 KB per turn that stays under the allowance', () => {
      const verdict = evaluate(steady(2_000));
      expect(verdict.retainedBytes).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
      expect(verdict.pass).toBe(false);
      expect(
        verdict.failures.some((failure) => failure.includes('fitted')),
      ).toBe(true);
    });

    it('rejects a leak of one row per turn', () => {
      const verdict = evaluate(steady(ROW_BYTES));
      expect(verdict.pass).toBe(false);
      expect(
        verdict.failures.some((failure) =>
          failure.includes('exceeds allowance'),
        ),
      ).toBe(true);
      expect(
        verdict.failures.some((failure) => failure.includes('fitted')),
      ).toBe(true);
    });

    it('accepts a single 250 KB step in the first half with a flat tail', () => {
      const verdict = evaluate([
        0, 250_000, 250_000, 250_000, 250_000, 250_000,
      ]);
      expect(verdict.pass).toBe(true);
    });

    it('rejects a step in the second half combined with continued growth', () => {
      const verdict = evaluate([0, 0, 0, 250_000, 350_000, 450_000]);
      expect(verdict.pass).toBe(false);
    });

    it('accepts flat noise', () => {
      const verdict = evaluate([
        100_000, -100_000, 150_000, 0, 120_000, -80_000,
      ]);
      expect(verdict.pass).toBe(true);
    });

    it('rejects a first-half step that is above the allowance even when the tail is flat', () => {
      const over = RETAINED_ALLOWANCE_BYTES + 1;
      const verdict = evaluate([0, over, over, over, over, over]);
      expect(verdict.pass).toBe(false);
    });
  });

  describe('warm-up convergence', () => {
    const RULE_FLOOR_TURNS = 550;
    const NEEDED_READINGS = CONVERGENCE_WINDOW_SAMPLES * CONVERGENCE_WINDOWS;

    /** First sampled turn at or after turn 550 where the rule holds. */
    function firstConvergedTurn(readings: readonly number[]): number | null {
      for (let count = 1; count <= readings.length; count++) {
        const turn = count * WARMUP_SAMPLE_EVERY_TURNS;
        if (turn >= RULE_FLOOR_TURNS && hasConverged(readings.slice(0, count)))
          return turn;
      }
      return null;
    }

    it('converges on the CI series despite isolated dips, by turn 600', () => {
      // The CI series was recorded every 5 turns; the warm-up now reads every 10.
      const everyTenTurns = CI_WARMUP_HEAP_READINGS.filter(
        (_, index) => index % 2 === 1,
      );
      const turn = firstConvergedTurn(everyTenTurns);
      expect(turn).not.toBeNull();
      expect(turn).toBeLessThanOrEqual(600);
    });

    it('converges on the CI series from either 10-turn phase of the recording', () => {
      const offPhase = CI_WARMUP_HEAP_READINGS.filter(
        (_, index) => index % 2 === 0,
      );
      expect(firstConvergedTurn(offPhase)).not.toBeNull();
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
      const step = Math.floor(
        (SETTLE_NOISE_BYTES * 0.75) / CONVERGENCE_WINDOW_SAMPLES,
      );
      const climbing = Array.from(
        { length: 150 },
        (_, index) => 100_000_000 + index * step,
      );
      expect(firstConvergedTurn(climbing)).toBeNull();
    });

    it('converges on a flat series with periodic dips', () => {
      const dipped = Array.from({ length: 150 }, (_, index) =>
        index % 7 === 3 ? 170_000_000 - 1_500_000 : 170_000_000,
      );
      expect(firstConvergedTurn(dipped)).toBe(RULE_FLOOR_TURNS);
    });

    it('needs three full windows of readings', () => {
      expect(hasConverged(Array(NEEDED_READINGS - 1).fill(170_000_000))).toBe(
        false,
      );
      expect(hasConverged(Array(NEEDED_READINGS).fill(170_000_000))).toBe(true);
    });
  });
});
