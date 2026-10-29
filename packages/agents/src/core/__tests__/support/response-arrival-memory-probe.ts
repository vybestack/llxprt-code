/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { z } from 'zod';
import {
  heapAccepted,
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';

const resultSchema = z.object({
  chunks: z.number(),
  trap: z.boolean(),
  mode: z.enum(['direct', 'streaming']),
  retainedBytes: z.number(),
  retainedExtraBytes: z.number(),
  countedBytes: z.number(),
  outputBytes: z.number(),
  delivered: z.number(),
  heldChunks: z.number(),
  checkpoints: z.record(
    z.string(),
    z.object({ heap: z.number(), external: z.number() }),
  ),
});
type Mode = z.infer<typeof resultSchema>['mode'];

function record(result: object): void {
  const path = process.env.RESPONSE_ARRIVAL_MEMORY_OUTPUT;
  if (path !== undefined) appendFileSync(path, JSON.stringify(result) + '\n');
}

function measure(
  chunks: number,
  trap: boolean,
  mode: Mode,
): z.infer<typeof resultSchema> {
  const child = spawnSync(
    process.execPath,
    [
      '--preload',
      new URL(
        '../../../../../../scripts/tests/storage-isolation-guard.ts',
        import.meta.url,
      ).pathname,
      new URL(
        '../../../../../../scripts/tests/response-arrival-memory-child.ts',
        import.meta.url,
      ).pathname,
      String(chunks),
      trap ? 'trap' : 'normal',
      mode,
    ],
    { encoding: 'utf8', timeout: 180000 },
  );
  if (child.status !== 0)
    throw new Error(`Arrival probe failed (${child.status}): ${child.stderr}`);
  const result = resultSchema.parse(JSON.parse(child.stdout.trim()));
  if (result.chunks !== chunks || result.trap !== trap || result.mode !== mode)
    throw new Error('Different arrival workload');
  expect(result.delivered).toBe(chunks);
  expect(result.heldChunks).toBe(trap ? chunks : 0);
  expect(result.outputBytes).toBeGreaterThan(chunks * 65500);
  record(result);
  return result;
}

function pair(trap: boolean, mode: Mode): PairedDelta {
  const small = measure(32, trap, mode);
  const large = measure(384, trap, mode);
  const delta = {
    heap: large.retainedBytes - small.retainedBytes,
    external: large.retainedExtraBytes - small.retainedExtraBytes,
  };
  record({
    mode,
    trap,
    delta,
    accepted: heapAccepted(small, large, RETAINED_ALLOWANCE_BYTES),
  });
  return delta;
}

export function responseArrivalMemoryEstimate(
  mode: Mode,
  trap: boolean,
): ReturnType<typeof pairedEstimate> {
  const estimate = pairedEstimate(
    Array.from({ length: 5 }, () => pair(trap, mode)),
  );
  record({ mode, trap, estimate });
  return estimate;
}
