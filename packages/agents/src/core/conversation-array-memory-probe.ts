/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import type { PairedDelta } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { recordArrayProof } from './__tests__/support/conversation-array-test-helpers.js';

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
export function pair(trap: boolean): PairedDelta {
  const small = measure(512, trap);
  const large = measure(8192, trap);
  return {
    heap: large.heap - small.heap,
    external: large.external - small.external,
  };
}

export { recordArrayProof };
