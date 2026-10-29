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
  historyRows: z.number().optional(),
  nextSeq: z.number().optional(),
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
    it(`rolls ${count} rows back from the journal without a strong marker ledger`, () => {
      const result = measure(count, 'actual');
      // The failed batch leaves no rows and restores the chronology counter by
      // value; history keeps no strong reference to the caller's displaced markers.
      expect(result.historyRows).toBe(0);
      expect(result.nextSeq).toBe(1);
      expect(result.aliveWhileDisplaced).toBe(0);
      expect(result.restoredIdentities).toBe(0);
      expect(result.aliveAfterSettlement).toBe(0);
    }, 120_000);

    it(`shows a disk descriptor plus weak handle loses all ${count} identities and restores values (negative control)`, () => {
      const result = measure(count, 'disk-weak');
      expect(result.aliveWhileDisplaced).toBe(0);
      expect(result.restoredIdentities).toBe(0);
      expect(result.restoredValues).toBe(count);
      expect(result.aliveAfterSettlement).toBe(0);
    }, 120_000);

    it(`keeps ${count} identities alive only with the deliberate context-length strong control (retention trap)`, () => {
      const result = measure(count, 'disk-strong');
      expect(result.aliveWhileDisplaced).toBe(count);
      expect(result.restoredIdentities).toBe(count);
      expect(result.restoredValues).toBe(count);
      expect(result.aliveAfterSettlement).toBe(0);
    }, 120_000);
  }
});
