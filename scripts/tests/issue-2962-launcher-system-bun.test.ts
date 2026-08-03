/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2962: on macOS the launcher prefers a Bun already on PATH when it
 * meets the pinned version floor, and only falls back to the bundled binary
 * otherwise.
 *
 * Why this matters: npm removes and re-extracts the entire package tree on
 * every install — including the nested bun dependency, even when that
 * dependency did not change — which unlinks the executable of every running
 * session. On macOS an unlinked executable cannot be identified by securityd,
 * so Keychain ACLs can no longer be evaluated and every credential operation
 * degrades to a login-password prompt. Exec'ing a Bun that npm does not own
 * removes the trigger.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  launcherPath,
  STANDARD_LAUNCH_TIMEOUT_MS,
  expectNoSpawnError,
  realBunVersion,
  makeLayout,
  makePinnedLayout,
} from './launcher-test-helpers.js';

const BUNDLED_MARKER = 'BUNDLED_BUN_RAN_ENTRY';
const STUB_MARKER = 'STUB_BUN_EXECED';
const BUNDLED_ENTRY_CODE = `console.log('${BUNDLED_MARKER}');`;

const describeDarwinOnly =
  process.platform === 'darwin' ? describe : describe.skip;

/**
 * Creates a stub `bun` on a private bin directory. The stub answers
 * `--version` with the supplied version and otherwise announces that it was
 * exec'd, so tests can tell which runtime the launcher chose.
 */
function makeStubBunDir(root: string, version: string): string {
  const binDir = join(root, `stub-bin-${version}`);
  mkdirSync(binDir, { recursive: true });
  const stub = join(binDir, 'bun');
  writeFileSync(
    stub,
    [
      '#!/bin/sh',
      'if [ "${1:-}" = "--version" ]; then',
      `  printf '%s\\n' '${version}'`,
      '  exit 0',
      'fi',
      `printf '${STUB_MARKER}\\n'`,
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(stub, 0o755);
  return binDir;
}

/** Bumps the patch component of a dotted version by one. */
function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split('-')[0].split('.');
  return `${major}.${minor}.${Number(patch) + 1}`;
}

function runLauncher(
  launcherTarget: string,
  pkgRoot: string,
  pathValue: string,
  args: string[] = [],
): ReturnType<typeof spawnSync> {
  return spawnSync(launcherTarget, args, {
    cwd: pkgRoot,
    encoding: 'utf8',
    timeout: STANDARD_LAUNCH_TIMEOUT_MS,
    env: { ...process.env, PATH: pathValue },
  });
}

describe('POSIX launcher system-Bun preference source gating', () => {
  it('gates the PATH probe on Darwin only', () => {
    const source = readFileSync(launcherPath, 'utf8');
    // Match the executable probe itself, not the prose in the comment above it.
    const probeIndex = source.indexOf(
      '_llxprt_path_bun_version=$(bun --version 2>/dev/null)',
    );
    expect(probeIndex).toBeGreaterThan(-1);
    // The probe must sit inside a Darwin-gated conditional so Linux and
    // Windows resolution stays exactly as it was.
    const guard = source.lastIndexOf(
      '[ "$_llxprt_kernel" = "Darwin" ]',
      probeIndex,
    );
    expect(guard).toBeGreaterThan(-1);
    // Nothing may close the conditional between the guard and the probe.
    expect(/\nfi\n/.test(source.slice(guard, probeIndex))).toBe(false);
  });
});

describeDarwinOnly('POSIX launcher system-Bun preference (issue #2962)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-sysbun-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prefers a PATH Bun that is newer than the pinned floor', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const stubDir = makeStubBunDir(tempDir, bumpPatch(realBunVersion()));
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
    );
    expectNoSpawnError(result);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(STUB_MARKER);
    expect(result.stdout).not.toContain(BUNDLED_MARKER);
  });

  it('accepts a PATH Bun exactly at the pinned floor', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const stubDir = makeStubBunDir(tempDir, realBunVersion());
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
    );
    expectNoSpawnError(result);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(STUB_MARKER);
  });

  it('falls back to the bundled Bun when the PATH Bun is below the floor', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const stubDir = makeStubBunDir(tempDir, '1.0.0');
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
    );
    expectNoSpawnError(result);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(BUNDLED_MARKER);
    expect(result.stdout).not.toContain(STUB_MARKER);
  });

  it('falls back to the bundled Bun when no Bun is on PATH', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const result = runLauncher(launcherTarget, pkgRoot, '/usr/bin:/bin');
    expectNoSpawnError(result);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(BUNDLED_MARKER);
  });

  it('ignores a PATH Bun when the package pin cannot be read', () => {
    // Without a readable pin there is no floor to compare against, so the
    // launcher must not accept an arbitrary PATH Bun.
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: BUNDLED_ENTRY_CODE,
    });
    const stubDir = makeStubBunDir(tempDir, '99.0.0');
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
    );
    expectNoSpawnError(result);
    // Assert the fallback actually succeeded, not merely that the stub was
    // skipped: an unreadable pin must still launch via the bundled runtime.
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(BUNDLED_MARKER);
    expect(result.stdout).not.toContain(STUB_MARKER);
  });

  it('forwards arguments through the PATH Bun', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const stubDir = join(tempDir, 'stub-args');
    mkdirSync(stubDir, { recursive: true });
    const stub = join(stubDir, 'bun');
    writeFileSync(
      stub,
      [
        '#!/bin/sh',
        'if [ "${1:-}" = "--version" ]; then',
        `  printf '%s\\n' '${bumpPatch(realBunVersion())}'`,
        '  exit 0',
        'fi',
        'shift',
        `printf 'ARGS:%s\\n' "$*"`,
        '',
      ].join('\n'),
    );
    chmodSync(stub, 0o755);
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
      ['a b', 'ünicode', '$HOME'],
    );
    expectNoSpawnError(result);
    expect(result.stdout).toContain('ARGS:a b ünicode $HOME');
  });
});
