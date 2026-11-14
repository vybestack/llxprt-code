/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  discoverTestFiles,
  selectCoreTestFiles,
} from '../../packages/core/run-bun-tests.js';
import {
  discoverTestFiles as discoverAgentsTestFiles,
  selectAgentsTestFiles,
} from '../../packages/agents/run-bun-tests.js';
import { resolveBunTestFiles } from '../bun-test-roots.js';
import {
  buildMatrix,
  SHARD_PARTITION_COUNTS,
} from '../affected-test-shards.js';
import { selectWeightedPartition } from '../lib/bun-test-partition.js';
import {
  JOURNAL_TEST_WEIGHTS_SECONDS,
  journalTestFileWeight,
} from '../lib/journal-test-weights.js';

const repoRoot = resolve(import.meta.dir, '../..');
const coreRoot = resolve(repoRoot, 'packages/core');

describe('journal workspace partitions', () => {
  it('weights only existing core, providers and agents tests with positive costs', () => {
    for (const [file, seconds] of Object.entries(
      JOURNAL_TEST_WEIGHTS_SECONDS,
    )) {
      expect(file).toMatch(/^packages\/(core|providers|agents)\//);
      expect(existsSync(resolve(repoRoot, file))).toBe(true);
      expect(Number.isFinite(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    }
  });

  it('leaves an unpartitioned core run complete and rejects malformed identities', () => {
    expect(selectCoreTestFiles(coreRoot)).toEqual(discoverTestFiles(coreRoot));
    expect(() => selectCoreTestFiles(coreRoot, '0of3')).toThrow();
    expect(() => selectCoreTestFiles(coreRoot, '4of3')).toThrow();
  });

  it('keeps unpartitioned agents discovery complete and rejects malformed identities', () => {
    const root = resolve(repoRoot, 'packages/agents');
    expect(selectAgentsTestFiles(root)).toEqual(discoverAgentsTestFiles(root));
    expect(() => selectAgentsTestFiles(root, '0of20')).toThrow();
    expect(() => selectAgentsTestFiles(root, '21of20')).toThrow();
  });

  for (const workspace of ['core', 'providers', 'agents']) {
    it(`runs every ${workspace} file once and keeps each leg below 25 minutes of serial work`, () => {
      const workspaceRoot = resolve(repoRoot, 'packages', workspace);
      const discover =
        workspace === 'core' ? discoverTestFiles : discoverAgentsTestFiles;
      const files =
        workspace === 'providers'
          ? resolveBunTestFiles(repoRoot, workspace).map((entry) => entry.file)
          : discover(workspaceRoot);
      const count = SHARD_PARTITION_COUNTS[workspace];
      expect(count).toBeGreaterThan(1);
      const partitions = buildMatrix([workspace]).map((row, index) => {
        if (workspace === 'core')
          return selectCoreTestFiles(workspaceRoot, row.partition);
        if (workspace === 'agents')
          return selectAgentsTestFiles(workspaceRoot, row.partition);
        return selectWeightedPartition(
          files.map((file) => ({ file })),
          { index: index + 1, count },
          repoRoot,
        ).map((entry) => entry.file);
      });
      expect(partitions).toHaveLength(count);
      expect(partitions.flat().sort()).toEqual([...files].sort());
      expect(new Set(partitions.flat()).size).toBe(files.length);
      for (const partition of partitions) {
        expect(partition.length).toBeGreaterThan(0);
        const seconds = partition.reduce(
          (sum, file) => sum + (journalTestFileWeight(repoRoot, file) ?? 0),
          0,
        );
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThan(25 * 60);
      }
    });
  }
});
