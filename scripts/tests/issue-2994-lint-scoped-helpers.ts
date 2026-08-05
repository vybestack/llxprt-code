/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hermetic fixture helpers for the scoped-lint behavioral tests (issue #2994).
 *
 * Every git command asserts its exit status (throwing with stderr on failure),
 * and each temp repository is configured to be independent of the developer's
 * global git configuration: deterministic EOL, no GPG signing, and an empty
 * hooks path. No stubbing of git, ESLint, or the runner — real child processes
 * in real temporary git repositories.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const LINT_SCOPED_SCRIPT = join(ROOT, 'scripts', 'lint-scoped.ts');

/** Result of spawning the real lint-scoped.ts in a repo cwd. */
export interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Tracks temp directories so a test's afterAll can remove them all. */
export class TempDirRegistry {
  private readonly dirs: string[] = [];

  track(dir: string): string {
    this.dirs.push(dir);
    return dir;
  }

  cleanupAll(): void {
    for (const dir of this.dirs.splice(0)) {
      // Best-effort: ignore failures so one bad dir never masks a real failure.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignored
      }
    }
  }
}

/**
 * Runs git in cwd, asserting exit 0. Throws with the failing command and
 * stderr so a fixture setup failure is debuggable rather than silent.
 */
export function runGit(
  cwd: string,
  args: readonly string[],
): { readonly stdout: string; readonly stderr: string } {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new Error(
      `git ${args.join(' ')} did not run in ${cwd}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (exit ${result.status}) in ${cwd}: ${result.stderr}`,
    );
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Spawns the real lint-scoped.ts in a repo cwd, capturing exit code and
 * output. An optional `env` overrides the child environment (used to prove
 * inherited LLXPRT_LINT_TARGETS does not influence the runner).
 */
export function runScoped(
  cwd: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): SpawnResult {
  const result = spawnSync(process.execPath, [LINT_SCOPED_SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    ...(env !== undefined ? { env } : {}),
  });
  if (result.error !== undefined) {
    throw new Error(`Failed to spawn lint-scoped: ${result.error.message}`);
  }
  if (result.signal !== null) {
    // Without this, an externally killed child surfaces as an opaque
    // `null !== 0` status mismatch instead of a debuggable diagnostic.
    throw new Error(
      `lint-scoped was killed by ${result.signal} in ${cwd}
${result.stderr ?? ''}`,
    );
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Writes a file under repo, creating parent directories recursively. */
export function writeFile(
  repo: string,
  relPath: string,
  content: string,
): void {
  const fullPath = join(repo, relPath);
  mkdirSync(resolve(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

/**
 * Creates a hermetic temporary git repository with a `main` branch, a fixture
 * package source file, and a clean local config (no GPG, no hooks, LF EOL).
 * Registers both the repo and its empty hooks dir for cleanup.
 */
export function createTempRepo(registry: TempDirRegistry): string {
  const dir = registry.track(mkdtempSync(join(tmpdir(), 'lint-scoped-2994-')));
  const emptyHooks = registry.track(
    mkdtempSync(join(tmpdir(), 'lint-scoped-hooks-')),
  );
  // Neutralize global config so the fixture is reproducible on any host.
  const configs: ReadonlyArray<readonly string[]> = [
    ['init', '--quiet'],
    ['symbolic-ref', 'HEAD', 'refs/heads/main'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'Test'],
    ['config', 'commit.gpgSign', 'false'],
    ['config', 'core.hooksPath', emptyHooks],
    ['config', 'core.autocrlf', 'false'],
    ['config', 'core.eol', 'lf'],
  ];
  for (const args of configs) {
    runGit(dir, args);
  }
  writeFileSync(join(dir, 'README.md'), '# test\n');
  mkdirSync(join(dir, 'packages', 'core', 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'packages', 'core', 'src', 'existing.ts'),
    'export const value = 1;\n',
  );
  runGit(dir, ['add', '-A']);
  runGit(dir, ['commit', '--quiet', '-m', 'init']);
  return dir;
}
