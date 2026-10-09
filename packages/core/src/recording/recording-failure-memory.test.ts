/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { heapAccepted } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { z } from 'zod';

interface Measurement {
  readonly heap: number;
  readonly external: number;
  readonly liveRows: number;
  readonly liveBytes: number;
  readonly count: number;
  readonly decodedDetails: number;
  readonly diagnosticBytes: number;
}
const measurementSchema = z.object({
  heap: z.number(),
  external: z.number(),
  liveRows: z.number(),
  liveBytes: z.number(),
  count: z.number(),
  decodedDetails: z.number(),
  diagnosticBytes: z.number(),
});
async function probe(count: number, trap: boolean): Promise<Measurement> {
  const script = new URL(
    '../../../../scripts/tests/recording-failure-memory-child.ts',
    import.meta.url,
  ).pathname;
  const child = Bun.spawn(
    [process.execPath, script, String(count), trap ? 'trap' : 'bounded'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) throw new Error(`Failure probe exited ${exit}: ${stderr}`);
  const value: unknown = JSON.parse(stdout);
  const result = measurementSchema.parse(value);
  const evidence = process.env['LLXPRT_FAILURE_MEMORY_EVIDENCE'];
  if (evidence !== undefined)
    await Bun.write(
      `${evidence}/${count}-${trap ? 'trap' : 'bounded'}.json`,
      stdout,
    );
  return result;
}
function accepted(small: Measurement, large: Measurement): boolean {
  return (
    heapAccepted(
      { retainedBytes: small.heap, retainedExtraBytes: small.external },
      { retainedBytes: large.heap, retainedExtraBytes: large.external },
      1048576,
    ) &&
    large.liveRows + large.decodedDetails <= 440 &&
    large.liveBytes + large.diagnosticBytes <= 8388608
  );
}
describe('failure report retained owners and fixed controls', () => {
  it('holds an undrained 8192-failure report within the 1MiB, 8MiB and 440 controls', async () => {
    const small = await probe(512, false);
    const large = await probe(8192, false);
    expect(large.count).toBe(8192);
    expect(accepted(small, large)).toBe(true);
  }, 120000);
  it('rejects an independent retaining trap with the same predicates', async () => {
    const small = await probe(512, true);
    const large = await probe(8192, true);
    expect(large.liveRows).toBe(8192);
    expect(accepted(small, large)).toBe(false);
    expect(large.heap - small.heap).toBeGreaterThan(1048576);
    expect(large.liveBytes).toBeGreaterThan(8388608);
  }, 120000);
});
