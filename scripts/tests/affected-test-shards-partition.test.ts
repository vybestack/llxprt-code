/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3185: CLI partition matrix expansion tests.
 *
 * These tests prove that the affected-test-shard selector expands the
 * logical `cli` shard into three physical matrix rows (1of3/2of3/3of3)
 * while other shards remain single-row (1of1). They exercise the REAL
 * selector (`scripts/affected-test-shards.ts`) via its CLI entry point
 * and the REAL checked-in graph.
 *
 * Split from affected-test-shards.test.ts to keep that file within the
 * 800-line lint limit.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asRecordArray, asString } from './typed-test-helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SELECTOR_PATH = join(REPO_ROOT, 'scripts', 'affected-test-shards.ts');

interface MatrixRow {
  readonly shard: string;
  readonly os: string;
  readonly 'node-version': string;
  readonly partition: string;
}

interface SelectorModule {
  buildMatrix: (selectedShards: readonly string[]) => readonly MatrixRow[];
  SHARD_PARTITION_COUNTS: Readonly<Record<string, number>>;
}

async function loadSelector(): Promise<SelectorModule> {
  return await import(SELECTOR_PATH);
}

const PR_EVENT = 'pull_request';
const ALL_SHARDS = ['cli', 'agents', 'providers', 'core', 'rest', 'scripts'];

/** Runs the selector CLI and returns the raw GITHUB_OUTPUT lines. */
function runSelectorRecords(paths: readonly string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'af-part-'));
  try {
    const files = join(dir, 'f.txt');
    const output = join(dir, 'o.txt');
    writeFileSync(files, paths.join('\n'));
    const run = spawnSync(
      process.execPath,
      [
        SELECTOR_PATH,
        '--event',
        PR_EVENT,
        '--files-from',
        files,
        '--output',
        'github-actions',
      ],
      { env: { ...process.env, GITHUB_OUTPUT: output } },
    );
    expect(run.stderr?.toString() ?? '').toBe('');
    expect(run.status).toBe(0);
    return readFileSync(output, 'utf8').split('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function recordsToMatrix(records: readonly string[]): readonly MatrixRow[] {
  const rec = records.find((l) => l.startsWith('matrix='));
  if (!rec) throw new Error('no matrix= record');
  return asRecordArray(JSON.parse(rec.substring('matrix='.length))).map(
    (row) => ({
      shard: asString(row['shard']),
      os: asString(row['os']),
      'node-version': asString(row['node-version']),
      partition: asString(row['partition']),
    }),
  );
}

function recordsKey(records: readonly string[], key: string): string {
  const rec = records.find((l) => l.startsWith(`${key}=`));
  if (!rec) throw new Error(`no ${key}= record`);
  return rec.substring(`${key}=`.length);
}

describe('affected-test-shards selector — CLI partition matrix (issue #3185)', () => {
  it('cli-only selection creates exactly three rows with logical shard cli', () => {
    const matrix = recordsToMatrix(
      runSelectorRecords(['schemas/settings.schema.json']),
    );
    expect(matrix).toHaveLength(3);
    expect(matrix.map((r) => r.partition).sort()).toEqual([
      '1of3',
      '2of3',
      '3of3',
    ]);
    for (const row of matrix) expect(row.shard).toBe('cli');
  });

  it('a non-cli shard creates one 1of1 row', () => {
    const matrix = recordsToMatrix(
      runSelectorRecords(['packages/providers/src/BaseProvider.test.ts']),
    );
    expect(matrix).toHaveLength(1);
    expect(matrix[0]?.shard).toBe('providers');
    expect(matrix[0]?.partition).toBe('1of1');
  });

  it('empty selection (docs-only) creates no rows', () => {
    const matrix = recordsToMatrix(
      runSelectorRecords(['docs/getting-started.md']),
    );
    expect(matrix).toEqual([]);
  });

  it('full selection preserves every logical shard and unique tuples', () => {
    const matrix = recordsToMatrix(runSelectorRecords(['package.json']));
    expect([...new Set(matrix.map((r) => r.shard))]).toEqual(ALL_SHARDS);
    const tuples = matrix.map(
      (r) => `${r.shard}|${r.partition}|${r.os}|${r['node-version']}`,
    );
    expect(new Set(tuples).size).toBe(tuples.length);
    for (const row of matrix) {
      expect(row.os).toBe('ubuntu-latest');
      expect(row['node-version']).toBe('24.x');
    }
  });

  it('github output still reports unchanged logical shard values', () => {
    const recs = runSelectorRecords(['schemas/settings.schema.json']);
    expect(recordsKey(recs, 'selected_shards')).toBe('cli');
    expect(recordsKey(recs, 'has_tests')).toBe('true');
    expect(recordsKey(recs, 'coverage_complete')).toBe('false');
  });

  it('configured partition counts name real logical shards and are positive integers', async () => {
    const { SHARD_PARTITION_COUNTS } = await loadSelector();
    for (const [shard, count] of Object.entries(SHARD_PARTITION_COUNTS)) {
      expect(ALL_SHARDS).toContain(shard);
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('buildMatrix: cli→three rows, non-cli→one 1of1, empty→none, full→all shards unique', async () => {
    const { buildMatrix } = await loadSelector();
    const cli = buildMatrix(['cli']);
    expect(cli).toHaveLength(3);
    expect(cli.map((r) => r.partition)).toEqual(['1of3', '2of3', '3of3']);
    expect(buildMatrix(['core'])[0]?.partition).toBe('1of1');
    expect(buildMatrix([])).toEqual([]);
    const full = buildMatrix(ALL_SHARDS);
    expect([...new Set(full.map((r) => r.shard))]).toEqual(ALL_SHARDS);
    const tuples = full.map(
      (r) => `${r.shard}|${r.partition}|${r.os}|${r['node-version']}`,
    );
    expect(new Set(tuples).size).toBe(tuples.length);
  });
});
