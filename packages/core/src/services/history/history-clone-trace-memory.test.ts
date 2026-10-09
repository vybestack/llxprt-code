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

const measurementSchema = z.object({
  size: z.number(),
  query: z.string(),
  trap: z.boolean(),
  heap: z.number(),
  external: z.number(),
});
function measure(size: number, query: string, trap: boolean): PairedDelta {
  const child = spawnSync(
    process.execPath,
    [
      new URL(
        '../../../../../scripts/tests/history-clone-trace-memory-child.ts',
        import.meta.url,
      ).pathname,
      String(size),
      query,
      trap ? 'trap' : 'stream',
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (child.status !== 0)
    throw new Error(`Clone/trace probe failed: ${child.stderr}`);
  const result = measurementSchema.parse(JSON.parse(child.stdout.trim()));
  if (result.size !== size || result.query !== query || result.trap !== trap)
    throw new Error('Probe returned a different workload');
  const output = process.env.HISTORY_CLONE_TRACE_PROBE_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, `${JSON.stringify(result)}\n`);
  return { heap: result.heap, external: result.external };
}
function pairedMeasurement(query: string, trap: boolean): PairedDelta {
  const small = measure(512, query, trap);
  const large = measure(8192, query, trap);
  return {
    heap: large.heap - small.heap,
    external: large.external - small.external,
  };
}

describe('suspended clone and trace iterator retained growth', () => {
  for (const query of ['clone', 'trace']) {
    it(`keeps ${query} 512/8192-row growth within the unchanged 1 MiB allowance`, () => {
      const estimate = pairedEstimate(
        Array.from({ length: 5 }, () => pairedMeasurement(query, false)),
      );
      expect(estimate.pass).toBe(true);
      expect(estimate.bound.heap).toBeLessThanOrEqual(RETAINED_ALLOWANCE_BYTES);
      expect(estimate.bound.external).toBeLessThanOrEqual(
        RETAINED_ALLOWANCE_BYTES,
      );
    }, 300_000);
    it(`rejects an eager ${query} generator retaining the full result`, () => {
      const estimate = pairedEstimate(
        Array.from({ length: 5 }, () => pairedMeasurement(query, true)),
      );
      expect(estimate.pass).toBe(false);
      expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
    }, 300_000);
  }
});
