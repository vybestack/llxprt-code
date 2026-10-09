/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { telemetryCapRow } from './telemetry-stream-fixture.js';
import { getRequestTextFromContents } from './turnLogging.js';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
const resultSchema = z.object({
  sampledDelta: z.number(),
  settledDelta: z.number(),
  externalDelta: z.number(),
  liveRows: z.number(),
  retainedRows: z.number(),
  retainedChunks: z.number(),
  receipt: z.object({ bytes: z.number(), sha256: z.string() }),
});
function oracle(): { bytes: number; sha256: string } {
  const fullLegacyVisiblePrefix = getRequestTextFromContents(
    Array.from({ length: 64 }, (_, index) => telemetryCapRow(index, true)),
  ).slice(0, 32 * 1024 * 1024);
  const bytes = Buffer.from(JSON.stringify(fullLegacyVisiblePrefix));
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
describe('full-cap telemetry process residency', () => {
  it('keeps full-cap SDK exporter and reader residency below unchanged 1MiB with row/chunk traps', async () => {
    const expected = oracle();
    const evidence = process.env.ISSUE854_LOGGING_EVIDENCE ?? root();
    const directory = join(
      evidence,
      `memory-${process.env.ISSUE854_CAP_TRAP ?? 'normal'}-${process.pid}`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'oracle.json'), JSON.stringify(expected));
    const child = Bun.spawn(
      ['bun', './packages/agents/src/core/telemetry-stream-memory-worker.ts'],
      {
        cwd: process.cwd(),
        env: { ...process.env, ISSUE854_CAP_MEMORY_ROOT: directory },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await writeFile(join(directory, 'worker.log'), stdout + stderr);
    expect(exit).toBe(0);
    const facts = resultSchema.parse(
      JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')),
    );
    expect(facts.receipt).toStrictEqual(expected);
    expect(facts.sampledDelta).toBeLessThan(1_048_576);
    expect(facts.settledDelta).toBeLessThan(1_048_576);
    expect(facts.externalDelta).toBeLessThan(1_048_576);
    expect(facts.liveRows).toBe(0);
    expect(facts.retainedRows).toBe(0);
    expect(facts.retainedChunks).toBe(0);
  }, 180000);
});
