/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

interface ScaleReport {
  readonly peakRetainedGrowthBytes: number;
  readonly rowCount: number;
  readonly neutralPayloadBytes: number;
  readonly operation: string;
}

function numericField(value: object, key: string): number {
  const field: unknown = Reflect.get(value, key);
  if (typeof field !== 'number' || !Number.isFinite(field))
    throw new Error(`Invalid scale metric: ${key}`);
  return field;
}

function scaleReport(value: unknown): ScaleReport {
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid scale report');
  if (!('operation' in value) || typeof value.operation !== 'string')
    throw new Error('Missing scale operation');
  return {
    peakRetainedGrowthBytes: numericField(value, 'peakRetainedGrowthBytes'),
    rowCount: numericField(value, 'rowCount'),
    neutralPayloadBytes: numericField(value, 'neutralPayloadBytes'),
    operation: value.operation,
  };
}

async function run(mode: string, root: string): Promise<ScaleReport> {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, '__tests__/support/arrival-scale-worker.ts'),
      mode,
      root,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, stderr }).toStrictEqual({ code: 0, stderr: '' });
  const report: unknown = JSON.parse(stdout);
  return scaleReport(report);
}

describe('arrival recording realistic session acceptance', () => {
  let directory: string;
  let small: ScaleReport;
  beforeAll(async () => {
    const root = join(import.meta.dir, '../../../../tmp/r4i-agent-record');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, 'scale-'));
    small = await run('small', directory);
  }, 180000);

  it('records 25K rows / 64 MiB without retaining the session', async () => {
    const full = await run('positive', directory);
    expect(full.rowCount).toBe(25000);
    expect(full.neutralPayloadBytes).toBe(64 * 1024 * 1024);
    expect(
      full.peakRetainedGrowthBytes - small.peakRetainedGrowthBytes,
    ).toBeLessThan(16 * 1024 * 1024);
  }, 180000);

  it('rejects an incremental recorder that also retains every payload', async () => {
    const control = await run('control', directory);
    expect(control.rowCount).toBe(25000);
    expect(control.operation).toBe('record');
  }, 180000);
});
