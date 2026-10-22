/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bun-test-free checked Git fixture helpers for the ast_read_file suites.
 *
 * This module deliberately imports nothing from `bun:test` so that child
 * processes (for example the memory-regression fixture generator) can reuse
 * the exact same checked wrapper instead of a weaker duplicate.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { devNull } from 'node:os';
import { isAbsolute } from 'node:path';

/** Bounded fixture Git timeout and output allowance. */
export const GIT_FIXTURE_TIMEOUT_MS = 30_000;
export const GIT_FIXTURE_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Fixture repositories are synthetic, so the machine's system and user Git
 * configuration must not leak in. Git for Windows ships `core.autocrlf=true`
 * in its system config, which makes every fixture file go through LF to CRLF
 * conversion and a per-file warning.
 */
const ISOLATED_GIT_CONFIG_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: devNull,
};

/** Render every failure mode of a checked fixture Git run. */
function describeGitFailure(
  args: readonly string[],
  result: SpawnSyncReturns<string>,
): string {
  const details = [
    `status=${String(result.status)}`,
    `signal=${String(result.signal)}`,
    `error=${result.error instanceof Error ? result.error.message : String(result.error)}`,
    `stderr=${String(result.stderr).trim().slice(0, 2000)}`,
  ];
  return `git ${args.join(' ')} failed (${details.join('; ')})`;
}

/**
 * The single shared checked Git fixture helper. Fails fixture setup loudly on
 * any nonzero status, signal death, or spawn error so a broken fixture can
 * never masquerade as behavior. The timeout and maxBuffer are explicit: a
 * large fixture (thousands of long paths) otherwise exceeds the runtime's
 * small default buffer allowance and is killed mid-write.
 * Returns captured stdout for callers that need fixture data back.
 */
export function gitCheck(dir: string, args: string[]): string {
  if (!isAbsolute(dir)) {
    throw new Error(`fixture git dir must be absolute, got: ${dir}`);
  }
  const result = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...process.env, ...ISOLATED_GIT_CONFIG_ENV },
    timeout: GIT_FIXTURE_TIMEOUT_MS,
    maxBuffer: GIT_FIXTURE_MAX_BUFFER,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(describeGitFailure(args, result));
  }
  return result.stdout;
}

/** Initializes a real Git repository with a stable identity. */
export function gitInit(dir: string): void {
  gitCheck(dir, ['init']);
  gitCheck(dir, ['config', 'user.email', 'test@example.com']);
  gitCheck(dir, ['config', 'user.name', 'Test']);
  // Some fixtures deliberately generate very long relative paths to force Git
  // to emit more stdout than a single pipe chunk. Those paths exceed Windows'
  // 260-character MAX_PATH, and Git refuses them with
  // "Filename too long", failing the commit rather than the assertion under
  // test. core.longpaths opts this fixture repository into Git's long-path
  // support so the byte volume the fixture needs is reachable on Windows too.
  // It is a no-op on POSIX, so the setting is applied unconditionally rather
  // than behind a platform branch.
  gitCheck(dir, ['config', 'core.longpaths', 'true']);
  // Fixture content is committed byte-for-byte: no line-ending conversion, and
  // no durability work (fsync per object, background gc) for throwaway trees.
  gitCheck(dir, ['config', 'core.autocrlf', 'false']);
  gitCheck(dir, ['config', 'core.safecrlf', 'false']);
  gitCheck(dir, ['config', 'core.fsync', 'none']);
  gitCheck(dir, ['config', 'gc.auto', '0']);
}

/** Stages and commits every fixture change; returns the resulting commit SHA. */
export function gitCommitAll(dir: string, message: string): string {
  gitCheck(dir, ['add', '-A']);
  gitCheck(dir, ['commit', '-m', message]);
  return gitCheck(dir, ['rev-parse', 'HEAD']).trim();
}
