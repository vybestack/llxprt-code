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
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from './token-accounting-stream-test-helpers.js';
import type { IContent } from './IContent.js';

const measurementSchema = z.object({
  size: z.number(),
  method: z.string(),
  trap: z.boolean(),
  heap: z.number(),
  external: z.number(),
  liveRows: z.number(),
  trapRows: z.number(),
});

function measure(size: number, method: string, trap: boolean): PairedDelta {
  const child = spawnSync(
    process.execPath,
    [
      new URL(
        '../../../../../scripts/tests/token-accounting-memory-child.ts',
        import.meta.url,
      ).pathname,
      String(size),
      method,
      trap ? 'trap' : 'stream',
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (child.status !== 0)
    throw new Error(`Accounting probe failed: ${child.stderr}`);
  const result = measurementSchema.parse(JSON.parse(child.stdout.trim()));
  if (
    result.size !== size ||
    result.method !== method ||
    result.trap !== trap
  ) {
    throw new Error('Accounting probe returned a different workload');
  }
  const output = process.env.TOKEN_ACCOUNTING_PROBE_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, `${JSON.stringify(result)}\n`);
  return { heap: result.heap, external: result.external };
}

function pairedMeasurement(method: string, trap: boolean): PairedDelta {
  const small = measure(512, method, trap);
  const large = measure(8192, method, trap);
  return {
    heap: large.heap - small.heap,
    external: large.external - small.external,
  };
}

describe('suspended token accounting retained growth', () => {
  for (const method of ['total', 'legacy']) {
    it(`keeps ${method} 512/8192-row growth within the unchanged 1 MiB allowance`, () => {
      const deltas = Array.from({ length: 5 }, () =>
        pairedMeasurement(method, false),
      );
      const estimate = pairedEstimate(deltas);
      expect(estimate.pass).toBe(true);
      expect(estimate.bound.heap).toBeLessThanOrEqual(RETAINED_ALLOWANCE_BYTES);
      expect(estimate.bound.external).toBeLessThanOrEqual(
        RETAINED_ALLOWANCE_BYTES,
      );
    }, 300_000);

    it(`rejects a ${method} retaining control holding the complete history`, () => {
      const deltas = Array.from({ length: 5 }, () =>
        pairedMeasurement(method, true),
      );
      const estimate = pairedEstimate(deltas);
      expect(estimate.pass).toBe(false);
      expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
    }, 300_000);
  }

  it('rejects eager fixture ownership at both scales and releases the retaining control', async () => {
    for (const size of [512, 8192]) {
      await withSuffixFixture(
        size,
        async (service, ownership) => {
          const retained: IContent[] = [];
          for await (const row of service.streamRawHistory()) {
            ownership.retain(row);
            retained.push(row);
          }
          try {
            expect(retained).toHaveLength(size);
            expect(
              ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(false);
            expect(ownership.snapshot().peakRows).toBeGreaterThan(440);
            expect(
              ownership.snapshot().peakSerializedBytes > 8 * 1024 * 1024,
            ).toBe(size === 8192);
          } finally {
            for (const row of retained) ownership.release(row);
          }
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(ownership.snapshot().liveSerializedBytes).toBe(0);
        },
        2048,
        accountingRow,
      );
    }
  }, 120_000);
});
