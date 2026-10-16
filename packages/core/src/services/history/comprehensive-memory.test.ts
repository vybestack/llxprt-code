/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';

const measurementSchema = z.object({
  size: z.number(),
  trap: z.boolean(),
  compressed: z.boolean(),
  heap: z.number(),
  external: z.number(),
  peakRows: z.number(),
  liveRows: z.number(),
});
async function measure(
  size: number,
  trap: boolean,
  compressed: boolean,
): Promise<PairedDelta> {
  const root = mkdtempSync(join(tmpdir(), 'comprehensive-probe-'));
  const measurementPath = join(root, 'measurement.json');
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        new URL(
          '../../../../../scripts/tests/comprehensive-memory-child.ts',
          import.meta.url,
        ).pathname,
        String(size),
        trap ? 'trap' : 'stream',
        compressed ? 'compressed' : 'plain',
        measurementPath,
      ],
      { stdout: 'pipe', stderr: 'pipe', timeout: 120_000 },
    );
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const output = process.env.COMPREHENSIVE_PROBE_OUTPUT;
    if (output !== undefined)
      appendFileSync(
        `${output}.children.jsonl`,
        `${JSON.stringify({ size, trap, compressed, status, stdout, stderr })}\n`,
      );
    if (status !== 0) throw new Error(`Comprehensive probe failed: ${stderr}`);
    const result = measurementSchema.parse(
      JSON.parse(readFileSync(measurementPath, 'utf8')),
    );
    if (
      result.size !== size ||
      result.trap !== trap ||
      result.compressed !== compressed
    )
      throw new Error('Probe returned a different workload');
    if (output !== undefined)
      appendFileSync(output, `${JSON.stringify(result)}\n`);
    if (!trap) {
      expect(result.peakRows).toBe(1);
      expect(result.liveRows).toBe(1);
    }
    return { heap: result.heap, external: result.external };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
async function pairedMeasurements(
  trap: boolean,
  compressed: boolean,
): Promise<PairedDelta[]> {
  const deltas: PairedDelta[] = [];
  for (let pair = 0; pair < 5; pair++) {
    const small = await measure(512, trap, compressed);
    const large = await measure(8192, trap, compressed);
    deltas.push({
      heap: large.heap - small.heap,
      external: large.external - small.external,
    });
  }
  return deltas;
}

describe('suspended comprehensive retained growth', () => {
  for (const compressed of [false, true]) {
    it(`keeps 512/8192-row growth within 1 MiB with compression=${compressed}`, async () => {
      const estimate = pairedEstimate(
        await pairedMeasurements(false, compressed),
      );
      expect(estimate.pass).toBe(true);
      expect(estimate.bound.heap).toBeLessThanOrEqual(RETAINED_ALLOWANCE_BYTES);
      expect(estimate.bound.external).toBeLessThanOrEqual(
        RETAINED_ALLOWANCE_BYTES,
      );
    }, 300_000);
    it(`rejects an eager full-result iterator with compression=${compressed}`, async () => {
      const estimate = pairedEstimate(
        await pairedMeasurements(true, compressed),
      );
      expect(estimate.pass).toBe(false);
      expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
    }, 300_000);
  }
});
