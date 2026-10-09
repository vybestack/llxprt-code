/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { appendFileSync } from 'node:fs';
function recordClientProof(value: object): void {
  const output = process.env.CLIENT_ARRAY_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(value) + '\n');
}
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
      '--preload',
      new URL(
        '../../../../scripts/tests/storage-isolation-guard.ts',
        import.meta.url,
      ).pathname,
      new URL(
        '../../../../scripts/tests/retained-array-memory-child.ts',
        import.meta.url,
      ).pathname,
      String(size),
      trap ? 'trap' : 'normal',
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (child.status !== 0 || child.stdout.trim() === '')
    throw new Error(`Client probe failed (${child.status}): ${child.stderr}`);
  const result = schema.parse(JSON.parse(child.stdout.trim()));
  if (result.size !== size || result.trap !== trap)
    throw new Error('Different client workload');
  recordClientProof(result);
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
describe('AgentClient deferred retained array suspended after durable acknowledgement', () => {
  it('bounds five paired original-full-row measurements below one MiB', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(false)),
    );
    recordClientProof({ kind: 'memory-positive', estimate });
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
  it('fails the same estimator when the actual caller retains the original input', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(true)),
    );
    recordClientProof({ kind: 'memory-caller-trap', estimate });
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
  it('charges input, stored and returned values against the unchanged 440/eight MiB checkpoints', () => {
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
