/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { z } from 'zod';
import type { PairedDelta } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';

const schema = z.object({
  size: z.number(),
  trap: z.boolean(),
  heap: z.number(),
  external: z.number(),
  heldRows: z.number(),
  heldBytes: z.number(),
  peakRows: z.number(),
  peakBytes: z.number(),
});
export function measure(size: number, trap: boolean): z.infer<typeof schema> {
  const child = spawnSync(
    process.execPath,
    [
      new URL(
        '../../../../../../../scripts/tests/semantic-purge-memory-child.ts',
        import.meta.url,
      ).pathname,
      String(size),
      trap ? 'trap' : 'normal',
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (child.status !== 0)
    throw new Error(`Semantic purge probe failed: ${child.stderr}`);
  const result = schema.parse(JSON.parse(child.stdout.trim()));
  if (result.size !== size || result.trap !== trap)
    throw new Error('Different probe workload');
  const output = process.env.SEMANTIC_PURGE_PROBE_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, `${JSON.stringify(result)}\n`);
  return result;
}
export function pair(trap: boolean): PairedDelta {
  const small = measure(512, trap);
  const large = measure(8192, trap);
  return {
    heap: large.heap - small.heap,
    external: large.external - small.external,
  };
}
