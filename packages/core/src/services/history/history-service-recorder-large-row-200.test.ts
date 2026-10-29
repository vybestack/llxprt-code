/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { MIB } from './__tests__/support/service-large-row.js';
import {
  largeRowAccepted,
  useLargeRowProof,
} from './__tests__/support/service-large-row-proof.js';

describe('HistoryService real-recorder 200 MiB row (defect 5)', () => {
  if (process.env['BUN_JSC_forceCodeBlockToJettisonDueToOldAge'] !== '1') {
    it('runs the 200 MiB retention proof with explicit code aging', async () => {
      // JSC reads this aging seam at VM startup, not when process.env changes.
      const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
        env: {
          ...process.env,
          BUN_JSC_forceCodeBlockToJettisonDueToOldAge: '1',
        },
        stdout: 'inherit',
        stderr: 'inherit',
      });
      try {
        expect(await child.exited).toBe(0);
      } finally {
        if (child.exitCode === null) {
          child.kill();
          await child.exited;
        }
      }
    }, 120_000);
    return;
  }
  const measureLargeRow = useLargeRowProof(200);
  it('persists and freshly resumes the complete row without retained context', async () => {
    const result = await measureLargeRow();
    expect(result.bytes).toBe(200 * MIB);
    expect(result.growth).toHaveLength(3);
    expect(Math.min(result.admissionGrowth, ...result.growth)).toBeGreaterThan(
      -256 * 1024,
    );
    expect({
      admissionGrowth: result.admissionGrowth,
      growth: result.growth,
      accepted: largeRowAccepted(result),
    }).toMatchObject({ accepted: true });
  }, 120_000);
});
