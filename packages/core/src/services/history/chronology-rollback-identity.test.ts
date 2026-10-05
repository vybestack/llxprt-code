/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { z } from 'zod';

const resultSchema = z.object({
  mode: z.enum(['actual', 'disk-weak', 'disk-strong']),
  count: z.number(),
  aliveWhileDisplaced: z.number(),
  restoredIdentities: z.number(),
  restoredValues: z.number(),
  aliveAfterSettlement: z.number(),
});
type IdentityMode = z.infer<typeof resultSchema>['mode'];

function measure(
  count: number,
  mode: IdentityMode,
): z.infer<typeof resultSchema> {
  const child = spawnSync(
    process.execPath,
    [
      new URL(
        '../../../../../scripts/tests/chronology-rollback-identity-child.ts',
        import.meta.url,
      ).pathname,
      String(count),
      mode,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (child.status !== 0)
    throw new Error(`Identity probe failed: ${child.stderr}`);
  const result = resultSchema.parse(JSON.parse(child.stdout.trim()));
  if (result.count !== count || result.mode !== mode)
    throw new Error('Changed identity workload');
  const output = process.env.CHRONOLOGY_IDENTITY_PROBE_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(result) + '\n');
  return result;
}

describe('chronology rollback identity with no external strong marker owners', () => {
  for (const count of [512, 8192]) {
    it(`restores all ${count} original marker identities after overwrite and GC, then releases them`, () => {
      const result = measure(count, 'actual');
      expect(result.aliveWhileDisplaced).toBe(count);
      expect(result.restoredIdentities).toBe(count);
      expect(result.restoredValues).toBe(count);
      expect(result.aliveAfterSettlement).toBe(0);
    }, 120_000);

    it(`exposes loss of all ${count} identities in a disk descriptor plus weak-handle negative control`, () => {
      const result = measure(count, 'disk-weak');
      expect(result.aliveWhileDisplaced).toBe(0);
      expect(result.restoredIdentities).toBe(0);
      expect(result.restoredValues).toBe(count);
      expect(result.aliveAfterSettlement).toBe(0);
    }, 120_000);

    it(`preserves ${count} disk-backed descriptor identities only with the context-length strong control`, () => {
      const result = measure(count, 'disk-strong');
      expect(result.aliveWhileDisplaced).toBe(count);
      expect(result.restoredIdentities).toBe(count);
      expect(result.restoredValues).toBe(count);
      expect(result.aliveAfterSettlement).toBe(0);
    }, 120_000);
  }
});
