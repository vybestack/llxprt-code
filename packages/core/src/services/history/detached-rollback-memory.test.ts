/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { z } from 'zod';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
} from '../../test-utils/retained-growth.js';
import { detachedRow } from './detached-rollback-test-helpers.js';

const schema = z.object({
  size: z.number(),
  lane: z.string(),
  preRows: z.number(),
  preBytes: z.number(),
  trap: z.boolean(),
  writerRows: z.number(),
  writerBytes: z.number(),
  writerAckEntered: z.boolean(),
  writerVisibleRows: z.number(),
  writerDurableRows: z.number(),
  heap: z.number(),
  external: z.number(),
  heldRows: z.number(),
  heldBytes: z.number(),
  trapRows: z.number(),
});
function measure(
  size: number,
  trap: boolean,
  lane = 'normal',
): z.infer<typeof schema> {
  const child = spawnSync(
    process.execPath,
    [
      new URL(
        '../../../../../scripts/tests/detached-rollback-memory-child.ts',
        import.meta.url,
      ).pathname,
      String(size),
      trap ? 'trap' : 'normal',
      lane,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (child.status !== 0)
    throw new Error(`Detached rollback probe failed: ${child.stderr}`);
  const result = schema.parse(JSON.parse(child.stdout.trim()));
  if (result.size !== size || result.trap !== trap || result.lane !== lane)
    throw new Error('Different workload');
  const output = process.env.DETACHED_MEMORY_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(result) + '\n');
  return result;
}
function pair(trap: boolean, lane = 'normal'): PairedDelta {
  const small = measure(512, trap, lane);
  const large = measure(8192, trap, lane);
  return {
    heap: large.heap - small.heap,
    external: large.external - small.external,
  };
}
function recordSummary(
  kind: string,
  estimate: ReturnType<typeof pairedEstimate>,
): void {
  const output = process.env.DETACHED_MEMORY_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify({ kind, estimate }) + '\n');
}

describe('detached borrowed lanes retained memory', () => {
  it.each(['array', 'pending'])(
    'releases %s input owners before post-ack retained sampling',
    (lane: string) => {
      const estimate = pairedEstimate(
        Array.from({ length: 5 }, () => pair(false, lane)),
      );
      recordSummary(lane, estimate);
      expect(estimate.pass).toBe(true);
      expect(estimate.bound.heap).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
      expect(estimate.bound.external).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
      const held = measure(8192, false, lane);
      expect(held.preRows).toBeGreaterThanOrEqual(8192);
      expect(held.preBytes).toBeGreaterThan(20_000_000);
      expect(held.heldRows).toBeLessThanOrEqual(440);
      expect(held.heldBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(held.heldRows).toBe(0);
      expect(held.heldBytes).toBe(0);
    },
    300_000,
  );
});

describe('detached post-ack retained memory', () => {
  it('keeps paired retained growth below the unchanged one-MiB allowance', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(false)),
    );
    recordSummary('positive', estimate);
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
  it('rejects live retained full-history ownership with the same estimator', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(true)),
    );
    recordSummary('trap', estimate);
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
  it('measures actual suspended owners against the original 440/eight-MiB limits', () => {
    for (const size of [512, 8192]) {
      const positive = measure(size, false);
      expect(positive.writerAckEntered).toBe(false);
      expect(positive.writerVisibleRows).toBe(1);
      expect(positive.writerDurableRows).toBe(0);
      expect(positive.writerRows).toBeGreaterThan(0);
      expect(positive.writerRows).toBeLessThanOrEqual(440);
      expect(positive.writerBytes).toBeGreaterThan(0);
      expect(positive.writerBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(positive.writerBytes).toBe(
        positive.writerRows * Buffer.byteLength(JSON.stringify(detachedRow(0))),
      );
      expect(positive.heldRows).toBeLessThanOrEqual(440);
      expect(positive.heldBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(positive.heldRows).toBe(0);
      expect(positive.heldBytes).toBe(0);
    }
    const trap = measure(8192, true);
    expect(trap.trapRows).toBe(8192);
    expect(trap.heldRows).toBeGreaterThan(440);
    expect(trap.heldBytes).toBeGreaterThan(8 * 1024 * 1024);
  }, 300_000);
});
