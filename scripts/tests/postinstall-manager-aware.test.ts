/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repoRoot = resolve(__dirname, '..', '..');
const realPostinstall = join(repoRoot, 'scripts', 'postinstall.cjs');
const realDetectInstaller = join(repoRoot, 'scripts', 'detect-installer.cjs');

const BUN_USER_AGENT = 'bun/1.3.14 npm/? node/v24.3.0 darwin arm64';
const NPM_USER_AGENT = 'npm/11.6.2 node/v24.3.0 darwin arm64';

// The npm bootstrap path shells out to `npm`. test:scripts runs on POSIX
// (macOS) in CI; the shell-script stub below is not portable to Windows, so the
// suite is skipped there rather than asserting on an unsupported platform.
const isWindows = process.platform === 'win32';

/**
 * A lockfile carrying an unsupported "peer" flag. The npm path strips this
 * flag (mutating the file); the Bun path must leave it untouched.
 */
function peerFlaggedLockfile(): string {
  return `${JSON.stringify(
    {
      name: 'fixture-root',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'fixture-root', version: '0.0.0' },
        'node_modules/example-peer': { version: '1.0.0', peer: true },
      },
    },
    null,
    2,
  )}\n`;
}

interface RunResult {
  status: number | null;
  stderr: string;
  npmInvoked: boolean;
  lockfile: string;
  bundleExists: boolean;
}

interface Fixture {
  dir: string;
  run(userAgent: string): RunResult;
}

const fixtures: string[] = [];

/**
 * Builds an isolated fixture that reproduces a clean GitHub-source checkout:
 * the real postinstall script, a peer-flagged lockfile, source `packages/`, and
 * NO prebuilt bundle. `npm` is shadowed on PATH by a stub that records its
 * invocation into a sentinel file, so tests can assert whether the npm
 * bootstrap ran without performing a real (networked) install.
 */
function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'postinstall-manager-'));
  fixtures.push(dir);

  mkdirSync(join(dir, 'scripts'));
  copyFileSync(realPostinstall, join(dir, 'scripts', 'postinstall.cjs'));
  copyFileSync(
    realDetectInstaller,
    join(dir, 'scripts', 'detect-installer.cjs'),
  );

  const lockfilePath = join(dir, 'package-lock.json');
  writeFileSync(lockfilePath, peerFlaggedLockfile());
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'fixture-root', version: '0.0.0' }, null, 2)}\n`,
  );

  // Source files present + no bundle => the GitHub-source build trigger.
  mkdirSync(join(dir, 'packages', 'dummy'), { recursive: true });

  const binDir = join(dir, 'bin');
  mkdirSync(binDir);
  const sentinel = join(dir, 'npm-invoked.sentinel');
  const npmStub = join(binDir, 'npm');
  // The sentinel path is passed to the stub via the NPM_SENTINEL env var rather
  // than interpolated into this shell-script text. Interpolating an OS-provided
  // tmpdir path directly into the script would break (or be injectable) if that
  // path ever contained shell-special characters such as spaces or quotes.
  writeFileSync(
    npmStub,
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$NPM_SENTINEL"\nexit 0\n',
  );
  chmodSync(npmStub, 0o755);

  return {
    dir,
    run(userAgent: string): RunResult {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        npm_config_user_agent: userAgent,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        // The npm stub appends to this path to record that it was invoked.
        NPM_SENTINEL: sentinel,
      };
      // Ensure the recursion guard is unset so the npm path reaches bootstrap.
      delete env.LLXPRT_POSTINSTALL_RUNNING;

      const result = spawnSync(
        process.execPath,
        [join(dir, 'scripts', 'postinstall.cjs')],
        { encoding: 'utf8', env },
      );

      return {
        status: result.status,
        stderr: result.stderr ?? '',
        npmInvoked: existsSync(sentinel),
        lockfile: readFileSync(lockfilePath, 'utf8'),
        bundleExists: existsSync(join(dir, 'bundle', 'llxprt.js')),
      };
    },
  };
}

afterEach(() => {
  while (fixtures.length > 0) {
    const dir = fixtures.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe.skipIf(isWindows)('postinstall package-manager awareness', () => {
  it('does not invoke the npm bootstrap when Bun drives the install', () => {
    const result = makeFixture().run(BUN_USER_AGENT);

    expect(result.status, result.stderr).toBe(0);
    expect(result.npmInvoked).toBe(false);
    expect(result.bundleExists).toBe(false);
  });

  it('leaves package-lock.json untouched when Bun drives the install', () => {
    const fixture = makeFixture();
    const before = readFileSync(join(fixture.dir, 'package-lock.json'), 'utf8');

    const result = fixture.run(BUN_USER_AGENT);

    expect(result.lockfile).toBe(before);
    expect(result.lockfile).toContain('"peer": true');
  });

  it('runs the npm bootstrap when npm drives a bundle-less checkout', () => {
    const result = makeFixture().run(NPM_USER_AGENT);

    expect(result.status, result.stderr).toBe(0);
    expect(result.npmInvoked).toBe(true);
    // The stub npm cannot produce a real bundle, so it must stay absent.
    // Asserting this keeps the test's expectations explicit and prevents a
    // silent regression if someone later expects the bundle to exist here.
    expect(result.bundleExists).toBe(false);
  });

  it('strips unsupported peer flags from package-lock.json under npm', () => {
    const result = makeFixture().run(NPM_USER_AGENT);

    // Assert structurally on the parsed lockfile rather than on its serialized
    // text, so the test tracks the actual behavior (the `peer` property being
    // removed) and not an incidental JSON formatting detail.
    const parsed = JSON.parse(result.lockfile) as {
      packages?: Record<string, { peer?: boolean }>;
    };
    expect(parsed.packages?.['node_modules/example-peer']).toBeDefined();
    expect(
      parsed.packages?.['node_modules/example-peer']?.peer,
    ).toBeUndefined();
  });
});
