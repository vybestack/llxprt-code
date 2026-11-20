/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROW_COUNT = 64;
const ROW_CHARS = 2 * 1024 * 1024;
/** One row in flight plus a constant, independent of how many rows are staged. */
const PEAK_ALLOWANCE_BYTES = ROW_CHARS + 1_048_576;
const SETTLED_ALLOWANCE_BYTES = 1_048_576;

interface Facts {
  readonly peakGrowth: number;
  readonly settledGrowth: number;
  readonly liveRows: number;
  readonly retainedRows: number;
  readonly rowCount: number;
  readonly contentBytes: number;
}

function numberField(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null || !(key in value))
    throw new Error(`worker result is missing ${key}`);
  const field: unknown = Reflect.get(value, key);
  if (typeof field !== 'number')
    throw new Error(`worker result ${key} is not a number`);
  return field;
}

function parseFacts(text: string): Facts {
  const raw: unknown = JSON.parse(text);
  return {
    peakGrowth: numberField(raw, 'peakGrowth'),
    settledGrowth: numberField(raw, 'settledGrowth'),
    liveRows: numberField(raw, 'liveRows'),
    retainedRows: numberField(raw, 'retainedRows'),
    rowCount: numberField(raw, 'rowCount'),
    contentBytes: numberField(raw, 'contentBytes'),
  };
}

function expectBounded(facts: Facts): void {
  expect(facts.peakGrowth).toBeLessThan(PEAK_ALLOWANCE_BYTES);
  expect(facts.settledGrowth).toBeLessThan(SETTLED_ALLOWANCE_BYTES);
  expect(facts.liveRows).toBe(0);
  expect(facts.retainedRows).toBe(0);
}

describe('stageRequestArtifact residency', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'request-artifact-memory-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function runWorker(trap: string | undefined): Promise<Facts> {
    await execFileAsync(
      'bun',
      [
        join(
          import.meta.dirname,
          '__tests__/support/request-artifact-memory-worker.ts',
        ),
      ],
      {
        cwd: import.meta.dirname,
        env: {
          ...process.env,
          REQUEST_ARTIFACT_MEMORY_ROOT: directory,
          REQUEST_ARTIFACT_MEMORY_ROWS: String(ROW_COUNT),
          REQUEST_ARTIFACT_MEMORY_ROW_CHARS: String(ROW_CHARS),
          ...(trap === undefined ? {} : { REQUEST_ARTIFACT_MEMORY_TRAP: trap }),
        },
      },
    );
    return parseFacts(await readFile(join(directory, 'result.json'), 'utf8'));
  }

  it('stages many large rows with memory bounded by one row plus a constant', async () => {
    const facts = await runWorker(undefined);
    expect(facts.rowCount).toBe(ROW_COUNT);
    expect(facts.contentBytes).toBeGreaterThanOrEqual(ROW_COUNT * ROW_CHARS);
    expectBounded(facts);
  }, 180000);

  it('trap: deliberately retained rows fail the residency gates', async () => {
    const facts = await runWorker('rows');
    expect(facts.rowCount).toBe(ROW_COUNT);
    expect(facts.retainedRows).toBe(ROW_COUNT);
    expect(() => expectBounded(facts)).toThrow('expect(received)');
  }, 180000);
});
