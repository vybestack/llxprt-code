/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { awaitShellGroupAbsence } from './helpers/shell-owner-gate.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

interface FixtureJob {
  id: string;
  pgid: number;
  log: string;
}
interface Ready {
  event: 'ready';
  baseline: number;
  afterConstruction: number;
  afterTwoLaunches: number;
  afterThreeLaunches: number;
  afterExplicitDispose: number;
  afterFailedDispose?: number;
  failedDisposal?: string;
  a: FixtureJob;
  b: FixtureJob;
  d: FixtureJob;
}

function groupAbsent(job: FixtureJob): boolean {
  try {
    process.kill(-job.pgid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return true;
    }
    throw error;
  }
}

async function runFixture(
  mode: 'natural-failure' | 'preset' | 'explicit-failure',
): Promise<number> {
  const root = await makeScratchDir('shell-exit-owners-');
  const node = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim();
  if (!node) throw new Error('Node executable not available');
  const child = spawn(
    node,
    [
      '--experimental-strip-types',
      resolve(
        resolveRepositoryFixture(
          import.meta.url,
          'packages/agents/src/api/__tests__/helpers/shell-owner-exit-fixture.ts',
        ),
      ),
      ...(mode === 'natural-failure' ? [] : [mode]),
    ],
    {
      cwd: resolve('.'),
      env: {
        ...process.env,
        TMPDIR: root,
        LLXPRT_CONFIG_HOME: root,
        LLXPRT_DATA_HOME: root,
        LLXPRT_CACHE_HOME: root,
        LLXPRT_LOG_HOME: root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ready: Ready | undefined;
  try {
    const completion = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const result = await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Shell fixture timed out: ${stdout} ${stderr}`)),
          22000,
        );
      }),
    ]);
    const line = stdout
      .split('\n')
      .find((entry) => entry.includes('"event":"ready"'));
    if (!line)
      throw new Error(`Missing public fixture readiness: ${stdout} ${stderr}`);
    ready = JSON.parse(line);
    if (!ready) throw new Error('Missing ready record');
    expect(ready.afterConstruction).toBe(ready.baseline);
    expect(ready.afterTwoLaunches).toBe(ready.baseline + 2);
    expect(ready.afterThreeLaunches).toBe(ready.baseline + 3);
    expect(ready.afterExplicitDispose).toBe(ready.baseline + 2);
    expect(result.signal).toBeNull();
    if (result.code === null)
      throw new Error('Fixture did not report an exit code');
    if (mode === 'explicit-failure') {
      expect(ready.afterFailedDispose).toBe(ready.baseline + 1);
      expect(ready.failedDisposal).toContain(
        'Cannot confirm shell process group',
      );
      expect(stderr).not.toContain('Shell owner shutdown failed:');
    } else {
      expect(stderr).toContain('Shell owner shutdown failed:');
    }
    const exitLine = stderr
      .split('\n')
      .find((entry) => entry.includes('"event":"exit"'));
    if (!exitLine) throw new Error(`Missing fixture exit record: ${stderr}`);
    const exitRecord: { listenerCount: number; exitCode?: number } =
      JSON.parse(exitLine);
    expect(exitRecord.listenerCount).toBe(ready.baseline);
    expect(exitRecord.exitCode ?? 0).toBe(result.code);
    await Promise.all(
      [ready.a, ready.b, ready.d].map((job) =>
        awaitShellGroupAbsence(job.pgid),
      ),
    );
    expect(existsSync(ready.a.log)).toBe(true);
    expect(existsSync(ready.b.log)).toBe(false);
    expect(existsSync(ready.d.log)).toBe(false);
    return result.code;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGTERM');
    if (ready && [ready.a, ready.b, ready.d].every(groupAbsent)) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

describe('public Agent beforeExit shell ownership', () => {
  it.skipIf(process.platform === 'win32')(
    'registers only launched owners, unregisters explicit disposal, and isolates one failed owner at natural exit',
    async () => {
      expect(await runFixture('natural-failure')).toBe(1);
    },
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'preserves an existing nonzero exit status when one owner fails and another succeeds',
    async () => {
      expect(await runFixture('preset')).toBe(7);
    },
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'removes only the failed explicitly disposed owner before sibling natural cleanup',
    async () => {
      expect(await runFixture('explicit-failure')).toBe(0);
    },
    30_000,
  );
});
