/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared fixtures for the POSIX launcher test suites.
 *
 * Extracted so the launcher specs (bundled-runtime resolution, source-workspace
 * resolution, system-Bun preference) build identical package layouts instead of
 * each carrying its own copy.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);

export const repoRoot = resolve(thisFile, '..', '..', '..');
export const launcherPath = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt');
export const repoBun = join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');

/**
 * The exit code the launcher uses for all launch-failure modes (missing Bun,
 * corrupt Bun, wrong platform/unrecognized format, missing entry point).
 * Centralized so a change to the launcher's failure code only requires updating
 * one place. Mirrors the LAUNCHER_ERROR_EXIT_CODE constant in
 * packages/cli/scripts/install-native-launchers.cjs.
 */
export const LAUNCHER_FAILURE_EXIT = 43;

/**
 * The bundled Bun binary filename. The launcher resolves and exec's
 * node_modules/bun/bin/<BUN_BINARY_NAME> on all platforms; on Windows the
 * launcher runs through the .cmd/.ps1 wrapper but the binary itself is still
 * named bun.exe. This constant makes the platform-independent binary name
 * explicit so a rename here stays in sync with the launcher.
 */
export const BUN_BINARY_NAME = 'bun.exe';

export const SHELL_PROBE_TIMEOUT_MS = 10_000;
export const SHORT_LAUNCH_TIMEOUT_MS = 15_000;
export const STANDARD_LAUNCH_TIMEOUT_MS = 30_000;

/**
 * Bun is a declared root dependency and a test prerequisite: the launcher
 * exec's it directly. A missing Bun means the repo install is broken — skipping
 * would hide that, so we throw rather than mark tests as skipped.
 */
export function ensureBun(): string {
  if (existsSync(repoBun)) {
    return repoBun;
  }
  // Use POSIX-standard 'command -v' instead of non-standard 'which' for
  // better portability on minimal container images.
  const commandVResult = spawnSync('sh', ['-c', 'command -v bun'], {
    encoding: 'utf8',
  });
  if (commandVResult.status === 0 && commandVResult.stdout.trim()) {
    return commandVResult.stdout.trim();
  }
  throw new Error('Bun not found for test setup');
}

/** Guard: surfaces spawn failures (ENOENT, EACCES) before null status checks. */
export function expectNoSpawnError(result: { error?: Error }): void {
  if (result.error) {
    throw new Error(`spawn failed: ${result.error.message}`);
  }
}

/**
 * Returns the real Bun version from the repo's bun package.json so tests can
 * write matching pins. Bun is a declared dependency and test prerequisite; a
 * missing/unreadable version indicates a broken installation, so we throw
 * rather than fall back to a hardcoded version that would become stale on the
 * next Bun upgrade.
 */
export function realBunVersion(): string {
  const bunPkgPath = join(repoRoot, 'node_modules', 'bun', 'package.json');
  const bunPkg = JSON.parse(readFileSync(bunPkgPath, 'utf8'));
  if (typeof bunPkg.version === 'string' && bunPkg.version.length > 0) {
    return bunPkg.version;
  }
  throw new Error(
    `Bun package.json at ${bunPkgPath} has no valid version field; ` +
      'the repo installation appears broken.',
  );
}

export function makeEntry(pkgRoot: string, code: string): void {
  writeFileSync(join(pkgRoot, 'index.ts'), `#!/usr/bin/env -S bun\n${code}\n`);
}

export function makeLayout(
  tempDir: string,
  opts: { withBun?: boolean; withIndex?: boolean; entryCode?: string } = {},
): { pkgRoot: string; launcherTarget: string } {
  const pkgRoot = join(tempDir, 'pkg');
  const binDir = join(pkgRoot, 'bin');
  mkdirSync(binDir, { recursive: true });

  const launcherTarget = join(binDir, 'llxprt');
  copyFileSync(launcherPath, launcherTarget);
  chmodSync(launcherTarget, 0o755);

  if (opts.withIndex !== false) {
    makeEntry(pkgRoot, opts.entryCode ?? 'process.exit(0);');
  }

  if (opts.withBun !== false) {
    const bunPath = ensureBun();
    const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
    mkdirSync(bunDir, { recursive: true });
    copyFileSync(bunPath, join(bunDir, BUN_BINARY_NAME));
  }

  return { pkgRoot, launcherTarget };
}

/**
 * Builds a layout whose package manifest pins Bun to the real bundled version,
 * and whose bundled Bun carries a matching package.json so the launcher's exact
 * pin check accepts it. Lets one layout exercise both a PATH candidate and the
 * bundled fallback.
 */
export function makePinnedLayout(
  tempDir: string,
  entryCode: string,
): { pkgRoot: string; launcherTarget: string } {
  const { pkgRoot, launcherTarget } = makeLayout(tempDir, { entryCode });
  const bunVersion = realBunVersion();
  writeFileSync(
    join(pkgRoot, 'package.json'),
    JSON.stringify(
      { name: '@vybestack/llxprt-code', dependencies: { bun: bunVersion } },
      null,
      2,
    ),
  );
  writeFileSync(
    join(pkgRoot, 'node_modules', 'bun', 'package.json'),
    JSON.stringify({ name: 'bun', version: bunVersion }, null, 2),
  );
  return { pkgRoot, launcherTarget };
}
