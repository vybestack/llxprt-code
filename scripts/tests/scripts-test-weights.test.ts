/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRootPartition } from '../lib/bun-test-partition.js';
import {
  DEFAULT_TEST_FILE_WEIGHT_SECONDS,
  SCRIPTS_TEST_WEIGHTS_SECONDS,
  scriptsTestWeight,
} from '../lib/scripts-test-weights.js';
import { SHARD_PARTITION_COUNTS } from '../affected-test-shards.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Per-leg ceiling for expected test time; the CI job limit is 45 minutes. */
const LEG_BUDGET_SECONDS = 25 * 60;

function entries(files: readonly string[]): Array<{ file: string }> {
  return files.map((file) => ({ file }));
}

describe('selectRootPartition with weights', () => {
  const weights: Record<string, number> = { big1: 100, big2: 90, big3: 80 };
  const weightOf = (file: string): number => weights[file] ?? 1;
  const names = ['big1', 'big2', 'big3', 'a', 'b', 'c', 'd'];

  it('puts each heavy file on its own partition and runs every file once', () => {
    const owned = ['1of3', '2of3', '3of3'].map((id) => {
      const [index, count] = id.split('of').map(Number);
      return selectRootPartition(
        entries(names),
        { index, count },
        weightOf,
      ).map((e) => e.file);
    });
    for (const heavy of ['big1', 'big2', 'big3']) {
      expect(owned.filter((files) => files.includes(heavy))).toHaveLength(1);
    }
    expect(owned.every((files) => files.some((f) => f.startsWith('big')))).toBe(
      true,
    );
    expect(owned.flat().sort()).toEqual([...names].sort());
  });

  it('is deterministic and preserves input order within a partition', () => {
    const identity = { index: 2, count: 3 };
    const first = selectRootPartition(entries(names), identity, weightOf);
    const second = selectRootPartition(entries(names), identity, weightOf);
    expect(second).toEqual(first);
    const positions = first.map((e) => names.indexOf(e.file));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('rejects a nonpositive weight', () => {
    expect(() =>
      selectRootPartition(entries(names), { index: 1, count: 3 }, () => 0),
    ).toThrow('must be positive');
  });
});

describe('scripts test weights', () => {
  it('names only files that exist (drift guard)', () => {
    for (const path of Object.keys(SCRIPTS_TEST_WEIGHTS_SECONDS)) {
      expect(existsSync(join(repoRoot, path))).toBe(true);
    }
  });

  it('weights unlisted files at the default', () => {
    expect(scriptsTestWeight('scripts/tests/not-a-listed-file.test.ts')).toBe(
      DEFAULT_TEST_FILE_WEIGHT_SECONDS,
    );
  });

  it('keeps every scripts CI leg well under the 45-minute job limit', () => {
    const count = SHARD_PARTITION_COUNTS['scripts'];
    const files = readdirSync(join(repoRoot, 'scripts/tests'))
      .filter((name) => name.endsWith('.test.ts'))
      .sort()
      .map((name) => `scripts/tests/${name}`);
    const legSeconds = Array.from({ length: count }, (_, i) =>
      selectRootPartition(
        entries(files),
        { index: i + 1, count },
        scriptsTestWeight,
      ).reduce((sum, e) => sum + scriptsTestWeight(e.file), 0),
    );
    for (const seconds of legSeconds) {
      expect(seconds).toBeLessThan(LEG_BUDGET_SECONDS);
    }
    const max = Math.max(...legSeconds);
    const min = Math.min(...legSeconds);
    expect(max - min).toBeLessThan(0.1 * max);
  });
});
