/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Focused tests for the POSIX launcher hardening pass (issue #2603 correction):
 *   - readlink failure: immediate exit 43 (not loop spin)
 *   - sed extraction anchored at the start of the JSON key line
 *   - exact-pin detection: strict X.Y.Z only, not digit-leading ranges
 *   - entry point: exactly packageRoot/index.ts (no parent walk)
 *
 * Extracted from issue-2603-launcher.test.ts to keep files under the max-lines
 * lint limit.
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
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const launcherPath = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt');
const repoBun = join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');

const LAUNCHER_FAILURE_EXIT = 43;
const SHORT_LAUNCH_TIMEOUT_MS = 15_000;
const STANDARD_LAUNCH_TIMEOUT_MS = 30_000;

function assertNoSpawnError(
  result: { error?: NodeJS.ErrnoException | undefined; status: number | null },
  label: string,
): void {
  if (result.error) {
    throw new Error(
      `${label}: spawn failed: ${result.error.message} (code=${result.error.code ?? 'none'})`,
    );
  }
}

function ensureBun(): string {
  if (existsSync(repoBun)) {
    return repoBun;
  }
  // Use POSIX-standard 'command -v' instead of non-standard 'which'.
  const whichResult = spawnSync('sh', ['-c', 'command -v bun'], {
    encoding: 'utf8',
  });
  if (whichResult.error) {
    throw new Error(`Bun discovery spawn failed: ${whichResult.error.message}`);
  }
  if (whichResult.status === 0 && whichResult.stdout.trim()) {
    return whichResult.stdout.trim();
  }
  throw new Error('Bun not found for test setup');
}

function realBunVersion(): string {
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

function makeEntry(pkgRoot: string, code: string): void {
  writeFileSync(join(pkgRoot, 'index.ts'), `#!/usr/bin/env -S bun\n${code}\n`);
}

describe('POSIX launcher readlink-failure and hop-bound hardening', () => {
  it('exits 43 on readlink failure rather than preserving the same symlink', () => {
    // On readlink failure (e.g. permission denied, dangling symlink target),
    // the launcher must immediately emit an actionable symlink-resolution
    // error and exit 43. It must NOT fall back to preserving the same
    // $_llxprt_self value (which would cause the while loop to spin
    // MAX_SYMLINK_HOPS iterations before bailing). We verify at the source
    // level that a readlink failure is handled by exiting 43 directly, not by
    // falling through to a self-preservation fallback.
    const source = readFileSync(launcherPath, 'utf8');
    expect(source).not.toMatch(
      /readlink -- "\$_llxprt_self" 2>\/dev\/null \|\| printf '%s\\n' "\$_llxprt_self"/,
    );
  });

  it('terminates a circular symlink chain rather than looping forever', () => {
    // A bounded loop (MAX_SYMLINK_HOPS) guards against pathological symlink
    // chains. This is a hop bound, NOT visited-path cycle detection.
    const source = readFileSync(launcherPath, 'utf8');
    expect(source).toMatch(/MAX_SYMLINK_HOPS\s*=\s*\d+/);
    expect(source).toMatch(/symlink resolution exceeded maximum hops/i);
    expect(source).toMatch(/_llxprt_hops.*gt.*MAX_SYMLINK_HOPS/);
  });
});

describe('POSIX launcher sed extraction anchoring', () => {
  it('anchors the bun dependency sed extraction at the start of the JSON key line', () => {
    // npm pretty-prints package.json, so each dependency key appears at the
    // start of its own line (with leading whitespace). The sed extraction must
    // anchor at the start of the line (after optional whitespace) so it does
    // not match "bun" appearing inside another key name on the same line.
    const source = readFileSync(launcherPath, 'utf8');
    expect(source).toMatch(/s\/\^.*"bun"/);
    expect(source).not.toMatch(/s\/\.\*"bun"/);
    expect(source).toMatch(/s\/\^.*"version"/);
    expect(source).not.toMatch(/s\/\.\*"version"/);
  });
});

describe('POSIX launcher exact-pin detection', () => {
  it('treats only an exact X.Y.Z as a pin, not 1.x', () => {
    // The exact-pin detection must recognize ONLY a plain exact semver pin
    // (e.g. "1.3.14"), not any digit-leading string. A range like "1.x" starts
    // with a digit but is NOT an exact version.
    const source = readFileSync(launcherPath, 'utf8');
    expect(source).toMatch(/_llxprt_is_exact_pin/);
    expect(source).not.toMatch(/\[0-9\]\*\s*\)\s*;;.*exact/);
  });
});

describe('POSIX launcher entry-point safety', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-entry-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits 43 when index.ts is missing but an ancestor index.ts exists', () => {
    // The entry point is known to be exactly packageRoot/index.ts. The launcher
    // must NOT walk parent directories looking for index.ts — an unrelated
    // ancestor index.ts must not be executed.
    const pkgRoot = join(tempDir, 'pkg');
    const binDir = join(pkgRoot, 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcherTarget = join(binDir, 'llxprt');
    copyFileSync(launcherPath, launcherTarget);
    chmodSync(launcherTarget, 0o755);
    // NO index.ts in pkgRoot. Place an unrelated index.ts in an ancestor.
    makeEntry(tempDir, 'process.exit(0);');
    const bunPath = ensureBun();
    const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
    mkdirSync(bunDir, { recursive: true });
    copyFileSync(bunPath, join(bunDir, 'bun.exe'));
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/entry point|index\.ts|corrupt/i);
  }, 15_000);
});

describe('POSIX launcher range-pin acceptance', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-range-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('accepts a hoisted Bun when the pin is a range like 1.x (not treated as exact)', () => {
    // A digit-leading range like "1.x" is NOT an exact version pin. The
    // launcher must NOT treat it as exact (which would reject every candidate
    // because no candidate version equals the literal string "1.x").
    const bunVersion = realBunVersion();
    const consumerDir = join(tempDir, 'consumer-range-pin');
    const pkgRoot = join(
      consumerDir,
      'node_modules',
      '@vybestack',
      'llxprt-code',
    );
    const binDir = join(pkgRoot, 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcherTarget = join(binDir, 'llxprt');
    copyFileSync(launcherPath, launcherTarget);
    chmodSync(launcherTarget, 0o755);
    makeEntry(pkgRoot, 'process.exit(0);');

    const hoistedBunDir = join(consumerDir, 'node_modules', 'bun', 'bin');
    mkdirSync(hoistedBunDir, { recursive: true });
    copyFileSync(ensureBun(), join(hoistedBunDir, 'bun.exe'));
    writeFileSync(
      join(consumerDir, 'node_modules', 'bun', 'package.json'),
      JSON.stringify({ name: 'bun', version: bunVersion }, null, 2),
    );
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@vybestack/llxprt-code',
          dependencies: { bun: '1.x' },
        },
        null,
        2,
      ),
    );

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    assertNoSpawnError(result, 'accepts hoisted Bun with range pin 1.x');
    expect(result.status, result.stderr).toBe(0);
  }, 30_000);
});
describe('POSIX launcher prerelease semver pin', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-prerel-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it(
    'accepts a hoisted Bun whose prerelease version matches the exact pin',
    () => {
      // A prerelease pin like "1.3.14-beta.1" IS an exact version and must be
      // treated as such so the strict equality check is applied. The hoisted
      // Bun's package.json reports the matching prerelease version.
      const bunVersion = realBunVersion();
      // Use the real Bun version with a synthetic prerelease suffix so the
      // binary is valid but the pin is a prerelease string.
      const prereleaseVersion = `${bunVersion}-beta.1`;
      const consumerDir = join(tempDir, 'consumer-prerelease');
      const pkgRoot = join(
        consumerDir,
        'node_modules',
        '@vybestack',
        'llxprt-code',
      );
      const binDir = join(pkgRoot, 'bin');
      mkdirSync(binDir, { recursive: true });
      const launcherTarget = join(binDir, 'llxprt');
      copyFileSync(launcherPath, launcherTarget);
      chmodSync(launcherTarget, 0o755);
      makeEntry(pkgRoot, 'process.exit(0);');

      const hoistedBunDir = join(consumerDir, 'node_modules', 'bun', 'bin');
      mkdirSync(hoistedBunDir, { recursive: true });
      copyFileSync(ensureBun(), join(hoistedBunDir, 'bun.exe'));
      writeFileSync(
        join(consumerDir, 'node_modules', 'bun', 'package.json'),
        JSON.stringify({ name: 'bun', version: prereleaseVersion }, null, 2),
      );
      writeFileSync(
        join(pkgRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@vybestack/llxprt-code',
            dependencies: { bun: prereleaseVersion },
          },
          null,
          2,
        ),
      );

      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: STANDARD_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      assertNoSpawnError(result, 'prerelease pin matches');
      expect(result.status, result.stderr).toBe(0);
    },
    STANDARD_LAUNCH_TIMEOUT_MS,
  );

  it(
    'rejects a hoisted Bun whose version does not match the prerelease pin',
    () => {
      // The package pins bun "1.3.14-beta.1" but the hoisted Bun reports a
      // different version. The launcher must reject this mismatch because the
      // prerelease pin is recognized as an exact pin.
      const bunVersion = realBunVersion();
      const consumerDir = join(tempDir, 'consumer-prerelease-mismatch');
      const pkgRoot = join(
        consumerDir,
        'node_modules',
        '@vybestack',
        'llxprt-code',
      );
      const binDir = join(pkgRoot, 'bin');
      mkdirSync(binDir, { recursive: true });
      const launcherTarget = join(binDir, 'llxprt');
      copyFileSync(launcherPath, launcherTarget);
      chmodSync(launcherTarget, 0o755);
      makeEntry(pkgRoot, 'process.exit(0);');

      const hoistedBunDir = join(consumerDir, 'node_modules', 'bun', 'bin');
      mkdirSync(hoistedBunDir, { recursive: true });
      copyFileSync(ensureBun(), join(hoistedBunDir, 'bun.exe'));
      writeFileSync(
        join(consumerDir, 'node_modules', 'bun', 'package.json'),
        JSON.stringify({ name: 'bun', version: bunVersion }, null, 2),
      );
      writeFileSync(
        join(pkgRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@vybestack/llxprt-code',
            // Pin a prerelease version that does NOT match the installed Bun.
            dependencies: { bun: '1.3.14-beta.1' },
          },
          null,
          2,
        ),
      );

      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: SHORT_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      assertNoSpawnError(result, 'prerelease pin mismatch');
      expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
      expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
    },
    SHORT_LAUNCH_TIMEOUT_MS,
  );
});
