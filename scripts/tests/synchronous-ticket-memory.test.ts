/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface MemoryReport {
  readonly retainedBytes: number;
  readonly retainedExtraBytes: number;
  readonly pausedBytes: number;
  readonly historyRows: number;
}

function isReport(value: unknown): value is MemoryReport {
  if (typeof value !== 'object' || value === null) return false;
  return [
    'retainedBytes',
    'retainedExtraBytes',
    'pausedBytes',
    'historyRows',
  ].every((field) => typeof Reflect.get(value, field) === 'number');
}

async function measure(mode: string, size: number): Promise<MemoryReport> {
  const directory =
    process.env.SYNC_TICKET_EVIDENCE ??
    mkdtempSync(join(process.cwd(), 'tmp/sync-ticket-memory-'));
  const output = join(directory, `memory-${mode}-${size}`);
  mkdirSync(output, { recursive: true });
  const child = Bun.spawn(
    [
      process.execPath,
      'scripts/tests/synchronous-ticket-memory-child.ts',
      output,
      String(size),
      mode,
    ],
    {
      stdout: Bun.file(join(output, 'child.log')),
      stderr: Bun.file(join(output, 'child-error.log')),
    },
  );
  const exit = await child.exited;
  writeFileSync(join(output, 'child.exit'), String(exit));
  expect(exit).toBe(0);
  const report: unknown = JSON.parse(
    readFileSync(join(output, 'report.json'), 'utf8'),
  );
  if (!isReport(report)) throw new Error('Invalid synchronous memory report');
  expect(report.historyRows).toBe(size);
  return report;
}

describe('pinned synchronous ticket retained-memory contract', () => {
  it('keeps paused and acknowledged 512-to-8192 growth within one MiB', async () => {
    const small = await measure('released', 512);
    const large = await measure('released', 8192);
    expect(large.retainedBytes - small.retainedBytes).toBeLessThanOrEqual(
      1024 * 1024,
    );
    expect(
      large.retainedExtraBytes - small.retainedExtraBytes,
    ).toBeLessThanOrEqual(1024 * 1024);
    expect(large.pausedBytes - small.pausedBytes).toBeLessThanOrEqual(
      1024 * 1024,
    );
  }, 180_000);

  it('rejects the same allowance for an observer retaining every input row', async () => {
    const small = await measure('retaining', 512);
    const large = await measure('retaining', 8192);
    expect(large.retainedBytes - small.retainedBytes).toBeGreaterThan(
      1024 * 1024,
    );
    expect(large.pausedBytes - small.pausedBytes).toBeGreaterThan(1024 * 1024);
  }, 180_000);
});
