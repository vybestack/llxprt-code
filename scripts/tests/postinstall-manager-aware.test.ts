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
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
 * Builds a fixture that reproduces Bun's hoisted-linker output for workspace
 * cross-dependencies: a real (non-symlink) static copy of one workspace
 * package nested inside another workspace's node_modules. Used to assert that
 * postinstall, under Bun, replaces that static copy with a symlink to the real
 * workspace directory.
 */
function makeSymlinkFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'postinstall-symlink-'));
  fixtures.push(dir);

  mkdirSync(join(dir, 'scripts'));
  copyFileSync(realPostinstall, join(dir, 'scripts', 'postinstall.cjs'));
  copyFileSync(
    realDetectInstaller,
    join(dir, 'scripts', 'detect-installer.cjs'),
  );

  // Root declares both packages as workspaces.
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture-root',
        version: '0.0.0',
        workspaces: ['packages/*'],
      },
      null,
      2,
    )}
`,
  );

  // The "real" workspace `foo`, with a marker file proving identity.
  mkdirSync(join(dir, 'packages', 'foo'), { recursive: true });
  writeFileSync(
    join(dir, 'packages', 'foo', 'package.json'),
    `${JSON.stringify({ name: '@vybestack/foo', version: '1.0.0' }, null, 2)}
`,
  );
  writeFileSync(join(dir, 'packages', 'foo', 'REAL'), '');

  // A consumer workspace `bar`.
  mkdirSync(join(dir, 'packages', 'bar'), { recursive: true });
  writeFileSync(
    join(dir, 'packages', 'bar', 'package.json'),
    `${JSON.stringify(
      {
        name: '@vybestack/bar',
        version: '1.0.0',
        dependencies: { '@vybestack/foo': 'file:../foo' },
      },
      null,
      2,
    )}
`,
  );

  // Bun's hoisted linker would materialize this as a STATIC COPY (real dir),
  // not a symlink. Seed that copy with a STALE marker so the test can prove it
  // was replaced (the marker vanishes) rather than left in place.
  const copyDir = join(
    dir,
    'packages',
    'bar',
    'node_modules',
    '@vybestack',
    'foo',
  );
  mkdirSync(copyDir, { recursive: true });
  writeFileSync(join(copyDir, 'STALE'), '');

  // Shadow `npm` with a no-op stub (as makeFixture does) so the npm bootstrap
  // path does not perform a real networked install when this fixture is used to
  // assert npm-path behavior.
  const binDir = join(dir, 'bin');
  mkdirSync(binDir);
  const sentinel = join(dir, 'npm-invoked.sentinel');
  const npmStub = join(binDir, 'npm');
  writeFileSync(
    npmStub,
    // String.raw keeps printf's literal `\n` (so printf emits a trailing
    // newline) instead of letting JS interpret it as a line break inside the
    // stub source.
    String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$NPM_SENTINEL"
exit 0
`,
  );
  chmodSync(npmStub, 0o755);

  return {
    dir,
    run(userAgent: string): RunResult {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        npm_config_user_agent: userAgent,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        NPM_SENTINEL: sentinel,
      };
      delete env.LLXPRT_POSTINSTALL_RUNNING;

      const result = spawnSync(
        process.execPath,
        [join(dir, 'scripts', 'postinstall.cjs')],
        { encoding: 'utf8', env },
      );

      return {
        status: result.status,
        stderr:
          (result.error
            ? `spawn failed: ${result.error.message}
`
            : '') + (result.stderr ?? ''),
        npmInvoked: existsSync(sentinel),
        lockfile: '',
        bundleExists: false,
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
        // Surface a spawn failure (result.error, e.g. ENOENT) in the message: on
        // such a failure status is null and stderr is empty, which would
        // otherwise assert as an opaque "expected null to be 0".
        stderr:
          (result.error ? `spawn failed: ${result.error.message}\n` : '') +
          (result.stderr ?? ''),
        npmInvoked: existsSync(sentinel),
        lockfile: readFileSync(lockfilePath, 'utf8'),
        bundleExists: existsSync(join(dir, 'bundle', 'llxprt.js')),
      };
    },
  };
}
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

describe.skipIf(isWindows)('postinstall Bun workspace symlinking', () => {
  it('replaces a static workspace copy with a symlink under Bun', () => {
    const fixture = makeSymlinkFixture();
    const copyPath = join(
      fixture.dir,
      'packages',
      'bar',
      'node_modules',
      '@vybestack',
      'foo',
    );

    // Sanity: the fixture seeded a real directory (the static copy), not a link.
    expect(lstatSync(copyPath).isSymbolicLink()).toBe(false);

    const result = fixture.run(BUN_USER_AGENT);

    expect(result.status, result.stderr).toBe(0);
    // The static copy was replaced with a symlink...
    expect(lstatSync(copyPath).isSymbolicLink()).toBe(true);
    // ...pointing at the real workspace directory.
    expect(realpathSync(copyPath)).toBe(
      realpathSync(join(fixture.dir, 'packages', 'foo')),
    );
    // The stale copy's marker is gone, and the real workspace's marker is now
    // reachable through the link.
    expect(existsSync(join(copyPath, 'STALE'))).toBe(false);
    expect(existsSync(join(copyPath, 'REAL'))).toBe(true);
  });

  it('is idempotent: re-running under Bun leaves the symlink intact', () => {
    const fixture = makeSymlinkFixture();

    fixture.run(BUN_USER_AGENT);
    const copyPath = join(
      fixture.dir,
      'packages',
      'bar',
      'node_modules',
      '@vybestack',
      'foo',
    );
    expect(lstatSync(copyPath).isSymbolicLink()).toBe(true);

    // A second run must not error and must leave the symlink in place.
    const result = fixture.run(BUN_USER_AGENT);
    expect(result.status, result.stderr).toBe(0);
    expect(lstatSync(copyPath).isSymbolicLink()).toBe(true);
    expect(existsSync(join(copyPath, 'REAL'))).toBe(true);
  });

  it('does not symlink workspace copies under npm', () => {
    const fixture = makeSymlinkFixture();
    const copyPath = join(
      fixture.dir,
      'packages',
      'bar',
      'node_modules',
      '@vybestack',
      'foo',
    );

    // Under npm, postinstall takes the bootstrap path (here a stubbed npm) and
    // never invokes the Bun-only symlinker, so the static copy must remain a
    // real directory with its stale marker untouched.
    const result = fixture.run(NPM_USER_AGENT);

    expect(result.status, result.stderr).toBe(0);
    expect(result.npmInvoked).toBe(true);
    expect(lstatSync(copyPath).isSymbolicLink()).toBe(false);
    expect(existsSync(join(copyPath, 'STALE'))).toBe(true);
  });
});
