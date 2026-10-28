/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { z } from 'zod';
import type { PairedDelta } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';

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

export function pairedMeasurement(method: string, trap: boolean): PairedDelta {
  const small = measure(512, method, trap);
  const large = measure(8192, method, trap);
  return {
    heap: large.heap - small.heap,
    external: large.external - small.external,
  };
}
