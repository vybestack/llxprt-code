/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { z } from 'zod';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';

const schema = z.object({
  size: z.number(),
  trap: z.boolean(),
  heap: z.number(),
  external: z.number(),
  heldRows: z.number(),
  heldBytes: z.number(),
  trapRows: z.number(),
});
function measure(size: number, trap: boolean): z.infer<typeof schema> {
  const child = spawnSync(
    process.execPath,
    [
      new URL(
        '../../../../../scripts/tests/chronology-rollback-memory-child.ts',
        import.meta.url,
      ).pathname,
      String(size),
      trap ? 'trap' : 'normal',
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (child.status !== 0)
    throw new Error(`Rollback probe failed: ${child.stderr}`);
  const result = schema.parse(JSON.parse(child.stdout.trim()));
  if (result.size !== size || result.trap !== trap)
    throw new Error('Different probe workload');
  const output = process.env.CHRONOLOGY_ROLLBACK_PROBE_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, `${JSON.stringify(result)}\n`);
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

describe('suspended chronology rollback transaction memory', () => {
  it('keeps 512/8192-row retained growth within the unchanged 1 MiB allowance', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(false)),
    );
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThanOrEqual(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThanOrEqual(
      RETAINED_ALLOWANCE_BYTES,
    );
  }, 300_000);

  it('rejects a deliberately retained full-history array using the same allowance', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(true)),
    );
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);

  it('keeps the fixed media/tool fixture below 440 borrowed owners and 8 MiB', () => {
    const result = measure(8192, false);
    expect(result.heldRows).toBeGreaterThan(0);
    expect(result.heldRows).toBeLessThanOrEqual(440);
  }, 120_000);

  it('keeps borrowed serialized payload below 8 MiB for the fixed media/tool fixture', () => {
    const result = measure(8192, false);
    expect(result.heldBytes).toBeGreaterThan(0);
    expect(result.heldBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  }, 120_000);

  it('rejects an eager control against both fixed-fixture bounds', () => {
    const result = measure(8192, true);
    expect(result.trapRows).toBe(result.size);
    expect(result.heldRows).toBeGreaterThan(440);
    expect(result.heldBytes).toBeGreaterThan(8 * 1024 * 1024);
  }, 120_000);
});
