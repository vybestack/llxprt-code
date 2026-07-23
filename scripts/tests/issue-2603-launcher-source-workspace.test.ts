/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the POSIX launcher's source-workspace resolution path
 * (issue #2610 regression: the launcher must find the hoisted root Bun when
 * run from the source workspace, without weakening the installed-package
 * boundary). Extracted from issue-2603-launcher.test.ts to keep files under
 * the max-lines lint limit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  chmodSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const launcherPath = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt');
const repoBun = join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');

// Exit code used by packages/cli/bin/llxprt when the bundled Bun runtime is
// missing, corrupt, or an unrecognized native format. Mirrors the
// LAUNCHER_ERROR_EXIT_CODE constant in install-native-launchers.cjs.
const LAUNCHER_FAILURE_EXIT = 43;

function ensureBun(): string {
  if (existsSync(repoBun) && statSync(repoBun).isFile()) {
    return repoBun;
  }
  const whichResult = spawnSync('which', ['bun'], { encoding: 'utf8' });
  if (whichResult.status === 0) {
    const bunPath = whichResult.stdout.trim();
    // Validate the discovered path is an existing regular file so
    // copyFileSync gets a clear diagnostic instead of a low-level OS error.
    if (bunPath && existsSync(bunPath) && statSync(bunPath).isFile()) {
      return bunPath;
    }
  }
  throw new Error('Bun not found for test setup');
}

function makeEntry(pkgRoot: string, code: string): void {
  writeFileSync(join(pkgRoot, 'index.ts'), `#!/usr/bin/env -S bun\n${code}\n`);
}

function isPackageJson(v: unknown): v is { version: string } {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>).version === 'string'
  );
}

function realBunVersion(): string {
  const bunPkgPath = join(repoRoot, 'node_modules', 'bun', 'package.json');
  // Bun is a declared dependency and test prerequisite (see root
  // trustedDependencies). A missing/unreadable version here indicates a
  // broken installation; throw rather than fall back to a hardcoded version
  // that would become stale on the next Bun upgrade.
  const bunPkg: unknown = JSON.parse(readFileSync(bunPkgPath, 'utf8'));
  if (isPackageJson(bunPkg) && bunPkg.version.length > 0) {
    return bunPkg.version;
  }
  throw new Error(
    `Bun package.json at ${bunPkgPath} has no valid version field; ` +
      'the repo installation appears broken.',
  );
}

describe('POSIX launcher source-workspace resolution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-source-ws-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Builds a synthetic source-workspace layout that mirrors the real repo:
   *   <wsRoot>/packages/cli/bin/llxprt       (launcher copy)
   *   <wsRoot>/packages/cli/index.ts          (entry)
   *   <wsRoot>/packages/cli/package.json      (CLI manifest with bun pin)
   *   <wsRoot>/package.json                   (root manifest with workspaces)
   *   <wsRoot>/node_modules/bun/bin/bun.exe   (hoisted root Bun)
   * The launcher sits OUTSIDE any node_modules, so resolution must use the
   * verified-workspace-root path (option 3).
   */
  function makeSourceWorkspace(
    baseDir: string,
    opts: {
      bunVersion?: string;
      cliPin?: string;
      rootWorkspaces?: string[];
      rootPkgName?: string;
      cliPkgName?: string;
      withBunPackageJson?: boolean;
      entryCode?: string;
    } = {},
  ): { wsRoot: string; pkgRoot: string; launcherTarget: string } {
    const wsRoot = join(baseDir, 'repo');
    const pkgRoot = join(wsRoot, 'packages', 'cli');
    const binDir = join(pkgRoot, 'bin');
    mkdirSync(binDir, { recursive: true });

    const launcherTarget = join(binDir, 'llxprt');
    copyFileSync(launcherPath, launcherTarget);
    chmodSync(launcherTarget, 0o755);

    const bunVersion = opts.bunVersion ?? realBunVersion();
    const cliPin = opts.cliPin ?? bunVersion;
    const cliName = opts.cliPkgName ?? '@vybestack/llxprt-code';
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify(
        { name: cliName, version: '0.10.0', dependencies: { bun: cliPin } },
        null,
        2,
      ),
    );

    makeEntry(pkgRoot, opts.entryCode ?? 'process.exit(0);');

    const rootName = opts.rootPkgName ?? cliName;
    const workspaces = opts.rootWorkspaces ?? [
      'packages/tools',
      'packages/cli',
      'packages/core',
    ];
    writeFileSync(
      join(wsRoot, 'package.json'),
      JSON.stringify(
        {
          name: rootName,
          version: '0.10.0',
          private: true,
          workspaces,
        },
        null,
        2,
      ),
    );

    const rootBunDir = join(wsRoot, 'node_modules', 'bun', 'bin');
    mkdirSync(rootBunDir, { recursive: true });
    copyFileSync(ensureBun(), join(rootBunDir, 'bun.exe'));
    if (opts.withBunPackageJson !== false) {
      writeFileSync(
        join(wsRoot, 'node_modules', 'bun', 'package.json'),
        JSON.stringify({ name: 'bun', version: bunVersion }, null, 2),
      );
    }

    return { wsRoot, pkgRoot, launcherTarget };
  }

  it('launches from a source workspace using the verified root Bun', () => {
    // The launcher is at packages/cli/bin/llxprt with NO enclosing
    // node_modules around the package. Resolution must verify the workspace
    // root (two levels up) and accept its node_modules/bun.
    const { pkgRoot, launcherTarget } = makeSourceWorkspace(tempDir);
    const result = spawnSync(launcherTarget, ['--version'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
  }, 30_000);

  it('launches the REAL source-workspace launcher (repo root)', () => {
    // Direct behavioral proof against the actual repo layout: the launcher at
    // packages/cli/bin/llxprt must resolve the real root node_modules/bun.
    const result = spawnSync(launcherPath, ['--version'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
  }, 30_000);

  it('accepts a source-workspace root via canonical structure regardless of manifest name', () => {
    // The workspace-root check now uses canonical filesystem structure
    // (<candidate>/packages/cli === pkg_root), NOT manifest content scanning.
    // A root whose manifest name differs from the package name is still
    // accepted because the structural layout is the trust boundary — the
    // candidate root is deterministically three parents up from the launcher.
    // This test documents that architectural decision: the structural check
    // replaces the former grep-based manifest verification.
    const { pkgRoot, launcherTarget } = makeSourceWorkspace(tempDir, {
      rootWorkspaces: ['packages/tools', 'packages/core'],
      rootPkgName: 'some-other-project',
    });
    const result = spawnSync(launcherTarget, ['--version'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    // The structural check passes (packages/cli is at the canonical path), so
    // the launcher finds the hoisted root Bun and exits 0.
    expect(result.status, result.stderr).toBe(0);
  }, 15_000);

  it('rejects a source-workspace root Bun whose package.json is missing (under exact pin)', () => {
    // The root Bun binary exists but its package.json is absent. Under an
    // exact pin the launcher must reject (not accept) the unversionable
    // candidate, so a partial/tampered install cannot bypass the pin.
    const { pkgRoot, launcherTarget } = makeSourceWorkspace(tempDir, {
      withBunPackageJson: false,
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
  }, 15_000);

  it('rejects a source-workspace root Bun whose version does not match the pin', () => {
    // The CLI pins bun "9.9.9" but the root Bun package.json reports a
    // different version. The launcher must reject the mismatch.
    const { pkgRoot, launcherTarget } = makeSourceWorkspace(tempDir, {
      bunVersion: '1.0.0',
      cliPin: '9.9.9',
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
  }, 15_000);

  it('does not climb an arbitrary ancestor that is not a verified workspace root', () => {
    // The package is at <tempDir>/a/b/packages/cli/bin/llxprt (NOT under a
    // node_modules). Two levels up is <tempDir>/a/b which has no package.json.
    // A Bun exists much higher at <tempDir>/node_modules/bun — the launcher
    // must NOT generic-climb to find it.
    const nested = join(tempDir, 'a', 'b');
    const { pkgRoot, launcherTarget, wsRoot } = makeSourceWorkspace(nested);
    // Remove the workspace root's Bun so the only Bun is the arbitrary
    // ancestor's.
    rmSync(join(wsRoot, 'node_modules', 'bun'), {
      recursive: true,
      force: true,
    });

    const ancestorBunDir = join(tempDir, 'node_modules', 'bun', 'bin');
    mkdirSync(ancestorBunDir, { recursive: true });
    copyFileSync(ensureBun(), join(ancestorBunDir, 'bun.exe'));

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
  }, 15_000);

  it('accepts a source-workspace root Bun whose version matches the pin', () => {
    const bunVersion = realBunVersion();
    const { pkgRoot, launcherTarget } = makeSourceWorkspace(tempDir, {
      bunVersion,
      cliPin: bunVersion,
    });
    const result = spawnSync(launcherTarget, ['--version'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
  }, 30_000);
});
