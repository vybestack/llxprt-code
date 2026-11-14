/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import type { PairedDelta } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { appendFileSync } from 'node:fs';
export function recordClientProof(value: object): void {
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
export function measure(size: number, trap: boolean): z.infer<typeof schema> {
  const child = spawnSync(
    process.execPath,
    [
      '--preload',
      new URL(
        '../../../../../../scripts/tests/storage-isolation-guard.ts',
        import.meta.url,
      ).pathname,
      new URL(
        '../../../../../../scripts/tests/retained-array-memory-child.ts',
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
export function pair(trap: boolean): PairedDelta {
  const small = measure(512, trap);
  const large = measure(8192, trap);
  return {
    heap: large.heap - small.heap,
    external: large.external - small.external,
  };
}
