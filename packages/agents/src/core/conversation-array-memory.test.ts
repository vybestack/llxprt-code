/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
} from '../../../core/src/test-utils/retained-growth.js';
import { recordArrayProof } from './conversation-array-test-helpers.js';

const schema = z.object({
  size: z.number(),
  trap: z.boolean(),
  heap: z.number(),
  external: z.number(),
  preRows: z.number(),
  preBytes: z.number(),
  heldRows: z.number(),
  heldBytes: z.number(),
  callerRows: z.number(),
  callerBytes: z.number(),
  storedRows: z.number(),
  returnedRows: z.number(),
});
function measure(size: number, trap: boolean): z.infer<typeof schema> {
  const child = spawnSync(
    process.execPath,
    [
      new URL(
        '../../../../scripts/tests/conversation-array-memory-child.ts',
        import.meta.url,
      ).pathname,
      String(size),
      trap ? 'trap' : 'normal',
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (child.status !== 0)
    throw new Error(`Conversation probe failed: ${child.stderr}`);
  const result = schema.parse(JSON.parse(child.stdout.trim()));
  if (result.size !== size || result.trap !== trap)
    throw new Error('Different caller workload');
  recordArrayProof(result);
  return result;
}
function pair(trap: boolean): PairedDelta {
  const small = measure(512, trap);
  const large = measure(8192, trap);
  return {
    heap: large.heap - small.heap,
    external: large.external - small.external,
  };
}

describe('ConversationManager array caller suspended after durable ack', () => {
  it('keeps five paired retained growth measurements below one MiB', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(false)),
    );
    recordArrayProof({ kind: 'memory-positive', estimate });
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
  it('fails the same estimator when the actual caller keeps its submitted array', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(true)),
    );
    recordArrayProof({ kind: 'memory-caller-trap', estimate });
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
  it('charges caller, stored and returned owners before and after ack against 440/eight MiB', () => {
    const positive = measure(8192, false);
    const trap = measure(8192, true);
    expect(positive.preRows).toBe(8192);
    expect(positive.preBytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(positive.callerRows).toBe(0);
    expect(positive.returnedRows).toBe(0);
    expect(positive.storedRows).toBeGreaterThan(0);
    expect(positive.heldRows).toBeLessThanOrEqual(440);
    expect(positive.heldBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(trap.callerRows).toBe(8192);
    expect(trap.callerBytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(trap.heldRows).toBeGreaterThan(440);
    expect(trap.heldBytes).toBeGreaterThan(8 * 1024 * 1024);
  }, 300_000);
});
