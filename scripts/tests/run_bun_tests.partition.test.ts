/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveTsconfigOverride,
  runBunTests,
  type BunGlobalSetupModule,
} from '../run_bun_tests.js';

const noGlobalSetup = async (): Promise<BunGlobalSetupModule> => ({});

describe('runBunTests --partition', () => {
  const entries = (names: string[]) =>
    names.map((name) => ({
      cwd: '/repo',
      file: `/repo/${name}.test.ts`,
      preloads: [],
    }));

  async function dryRun(
    names: string[],
    partition: string,
  ): Promise<{ status: number; stdout: string[]; stderr: string[] }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const status = await runBunTests(['--dry-run', '--partition', partition], {
      repoRoot: '/repo',
      invocationDirectory: '/repo',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => entries(names),
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => ({ exitCode: 0, signalCode: null }),
      loadGlobalSetup: noGlobalSetup,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    return { status, stdout, stderr };
  }

  it('partitions of a root cover every file exactly once, round robin', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const seen: string[] = [];
    for (const partition of ['1of3', '2of3', '3of3']) {
      const { status, stdout } = await dryRun(names, partition);
      expect(status).toBe(0);
      seen.push(...stdout.filter((l) => l.includes('.test.ts')));
    }
    expect(seen.sort()).toEqual(
      names.map((n) => `  [/repo] /repo/${n}.test.ts`),
    );
  });

  it('runs a root smaller than the partition count only on partition 1', async () => {
    const first = await dryRun(['only'], '1of3');
    expect(first.stdout).toContain('  [/repo] /repo/only.test.ts');
    for (const partition of ['2of3', '3of3']) {
      const other = await dryRun(['only'], partition);
      expect(other.status).toBe(0);
      expect(other.stdout.join('\n')).not.toContain('only.test.ts');
      expect(other.stdout.join('\n')).toContain('owns none of the 1');
    }
  });

  it('rejects a noncanonical partition identity', async () => {
    await expect(dryRun(['a'], '2-3')).rejects.toThrow('canonical partition');
  });
});
