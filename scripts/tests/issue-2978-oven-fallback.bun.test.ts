/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2978: `@oven/bun-<platform>` fallback for npm v12 default-deny of
 * install scripts.
 *
 * npm v12 disables dependency install scripts by default (RFC 0054), so the
 * `bun` package's `postinstall` (which MOVES the binary into
 * `bun/bin/bun.exe`) never runs. The launcher must fall back to the
 * `@oven/bun-<platform>` sub-package binary (`bin/bun[.exe]`), which has NO
 * scripts and materializes under default-deny.
 *
 * Every launcher test builds a real directory layout on disk and spawns the
 * real launcher; none mock the resolver. The pure variant-selection function
 * is driven over every host tuple against the upstream table parsed from
 * `node_modules/bun/install.js` at test time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  chmodSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  launcherPath,
  repoRoot,
  LAUNCHER_FAILURE_EXIT,
  SHORT_LAUNCH_TIMEOUT_MS,
  STANDARD_LAUNCH_TIMEOUT_MS,
  ensureBun,
  expectNoSpawnError,
  expectExitOk,
  realBunVersion,
  makeEntry,
  makePinnedLayout,
} from './launcher-test-helpers.js';
import {
  selectOvenVariants,
  OVEN_PACKAGE_NAMES,
  OVEN_PACKAGE_VERSION,
  detectHostPlatform,
  type HostPlatformInput,
} from '../../packages/cli/src/launcher/oven-bun-variants.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const installNativeLaunchers = require(
  join(repoRoot, 'packages', 'cli', 'scripts', 'install-native-launchers.cjs'),
) as {
  readonly _testing: {
    readonly resolveBunExe: (packageRoot: string) => string | null;
  };
};

/**
 * Creating a symlink on Windows requires elevation or Developer Mode, so
 * `symlinkSync` throws EPERM on an unprivileged host. Mirrors the pattern in
 * issue-2603-launcher.bun.test.ts.
 */
const itNeedsSymlinks = process.platform === 'win32' ? it.skip : it;

/**
 * The POSIX launcher (`#!/bin/sh`) requires `sh` on PATH. On stock Windows
 * there is no POSIX shell, so launcher-execution tests are skipped there.
 * Pure-logic, manifest, detection, and resolveBunExe tests still run
 * everywhere because they never spawn the launcher.
 */
const itPosix = process.platform === 'win32' ? it.skip : it;

/**
 * The launcher-behavior and resolveBunExe-parity suites run on ubuntu in CI.
 * Gate the entire describe on POSIX to stop the suite red-failing for every
 * Windows contributor. Mirrors the `describeDarwinOnly` idiom in
 * issue-2962-system-bun-preference.bun.test.ts.
 */
const describePosixOnly =
  process.platform === 'win32' ? describe.skip : describe;

const BUNDLED_MARKER = 'BUNDLED_BUN_RAN_ENTRY';
const OVEN_MARKER = 'OVEN_BUN_RAN_ENTRY';
const BUNDLED_ENTRY_CODE = `console.log('${BUNDLED_MARKER}');`;
const OVEN_ENTRY_CODE = `console.log('${OVEN_MARKER}');`;

/* ------------------------------------------------------------------ */
/* Helpers for building @oven layouts                                  */
/* ------------------------------------------------------------------ */

/**
 * The `@oven/bun-*` binary filename that would be present after npm extracts
 * the tarball. On win32 the upstream table uses `bun.exe`; on other platforms
 * `bun`. The launcher probes both names, so tests create whichever matches the
 * host so the binary is actually found.
 */
function hostOvenVariant(): {
  readonly packageName: string;
  readonly exeName: string;
} {
  const host =
    detectHostPlatform() ??
    (() => {
      throw new Error('could not detect host platform for @oven fixtures');
    })();
  const variants = selectOvenVariants(host);
  if (variants.length === 0) {
    throw new Error(
      `no @oven variant for host ${JSON.stringify(host)}; cannot build fixture`,
    );
  }
  return {
    packageName: variants[0].packageName,
    exeName: variants[0].exeNames[0],
  };
}

/**
 * Writes an `@oven/bun-<variant>` package layout with a real (copied) Bun
 * binary so the launcher can exec it. The package.json is pinned to the real
 * Bun version so the launcher's exact-pin check accepts it.
 *
 * `baseDir` is the directory that should CONTAIN the `@oven` scope folder
 * (e.g. a `node_modules` directory).
 */
function writeOvenPackage(
  baseDir: string,
  variant: { readonly packageName: string; readonly exeName: string },
  version: string = realBunVersion(),
): string {
  const pkgDir = join(baseDir, variant.packageName);
  const binDir = join(pkgDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const exePath = join(
    binDir,
    variant.exeName === 'bin/bun.exe' ? 'bun.exe' : 'bun',
  );
  copyFileSync(ensureBun(), exePath);
  chmodSync(exePath, 0o755);
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: variant.packageName, version }, null, 2),
  );
  return exePath;
}

/**
 * Builds the package-local layout with a `node_modules/bun/` directory present
 * but `bun/bin/bun.exe` ABSENT (the npm-v12 postinstall-blocked shape), plus a
 * valid `@oven` binary under `node_modules/@oven/<variant>`.
 */
function makeNpmV12Layout(
  tempDir: string,
  entryCode: string,
  opts: { readonly withOven?: boolean; readonly ovenVersion?: string } = {},
): { readonly pkgRoot: string; readonly launcherTarget: string } {
  const pkgRoot = join(tempDir, 'pkg');
  const binDir = join(pkgRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  const launcherTarget = join(binDir, 'llxprt');
  copyFileSync(launcherPath, launcherTarget);
  chmodSync(launcherTarget, 0o755);
  makeEntry(pkgRoot, entryCode);

  // node_modules/bun exists but bun/bin/bun.exe is ABSENT (postinstall blocked).
  mkdirSync(join(pkgRoot, 'node_modules', 'bun'), { recursive: true });
  writeFileSync(
    join(pkgRoot, 'node_modules', 'bun', 'package.json'),
    JSON.stringify({ name: 'bun', version: realBunVersion() }, null, 2),
  );

  const bunVersion = realBunVersion();
  writeFileSync(
    join(pkgRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@vybestack/llxprt-code',
        dependencies: { bun: bunVersion },
      },
      null,
      2,
    ),
  );

  if (opts.withOven !== false) {
    writeOvenPackage(
      join(pkgRoot, 'node_modules'),
      hostOvenVariant(),
      opts.ovenVersion ?? bunVersion,
    );
  }

  return { pkgRoot, launcherTarget };
}

/* ------------------------------------------------------------------ */
/* Upstream table parsing for variant-ordering + manifest tests        */
/* ------------------------------------------------------------------ */

interface UpstreamPlatformRow {
  readonly os: string;
  readonly arch: string;
  readonly avx2?: boolean;
  readonly abi?: string;
  readonly bin: string;
  readonly exe: string;
}

/**
 * Parses the platform table out of `node_modules/bun/install.js` at test time.
 * The table is an array literal assigned to `platforms = [ ... ]` immediately
 * before `supportedPlatforms = platforms.filter`. We extract it with a
 * tolerant line-based parser rather than eval'ing upstream code.
 */
function parseUpstreamTable(): readonly UpstreamPlatformRow[] {
  const installJsPath = join(repoRoot, 'node_modules', 'bun', 'install.js');
  const source = readFileSync(installJsPath, 'utf8');
  const startMarker = 'platforms = [';
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const openBracket = source.indexOf('[', start);
  // The table ends at the `]` immediately preceding `supportedPlatforms`.
  const endMarker = '], supportedPlatforms = platforms.filter';
  const end = source.indexOf(endMarker, openBracket);
  expect(end).toBeGreaterThan(-1);
  const tableSource = source.slice(openBracket, end + 1);

  const rows: UpstreamPlatformRow[] = [];
  let i = 0;
  const text = tableSource;
  while (i < text.length) {
    const objStart = text.indexOf('{', i);
    const objEnd = objStart === -1 ? -1 : text.indexOf('}', objStart);
    if (objStart === -1 || objEnd === -1) {
      break;
    }
    const objText = text.slice(objStart, objEnd + 1);
    const os = objText.match(/os:\s*"([^"]+)"/)?.[1];
    const arch = objText.match(/arch:\s*"([^"]+)"/)?.[1];
    const bin = objText.match(/bin:\s*"([^"]+)"/)?.[1];
    const exe = objText.match(/exe:\s*"([^"]+)"/)?.[1];
    const abi = objText.match(/abi:\s*"([^"]+)"/)?.[1];
    // String.match() returns null (not undefined) on no match, so check
    // against null here.
    const avx2Token = objText.match(/avx2:\s*!0/);
    if (os && arch && bin && exe) {
      rows.push({
        os,
        arch,
        bin,
        exe,
        abi,
        avx2: avx2Token !== null ? true : undefined,
      });
    }
    i = objEnd + 1;
  }
  if (rows.length !== 16) {
    throw new Error(
      `parseUpstreamTable extracted ${rows.length} rows, expected 16. ` +
        'This means bun install.js changed its platform table shape and the parser needs updating.',
    );
  }
  return rows;
}

/**
 * Computes the EXPECTED ordered package list for a host tuple using the parsed
 * upstream table and our documented selection rules (musl-first deviation).
 * This is an independent reference implementation so the test catches drift in
 * either the table or the rules.
 */
function expectedVariantOrder(
  table: readonly UpstreamPlatformRow[],
  os: string,
  arch: string,
  abi: string | undefined,
  avx2: boolean,
): readonly string[] {
  const rowRuns = (row: UpstreamPlatformRow): boolean => {
    if (row.os !== os || row.arch !== arch) {
      return false;
    }
    if (row.avx2 === true && !avx2) {
      return false;
    }
    return row.abi === undefined || row.abi === abi;
  };
  // On a musl host, musl rows sort ahead of the glibc fallback rows. On any
  // other host all rows tie here and only the avx2 key matters.
  const muslRank = (row: UpstreamPlatformRow): number => {
    if (abi !== 'musl') {
      return 0;
    }
    return row.abi === 'musl' ? 0 : 1;
  };
  const avxRank = (row: UpstreamPlatformRow): number =>
    row.avx2 === true ? 0 : 1;

  const sorted = [...table.filter(rowRuns)].sort((a, b) => {
    const muslDiff = muslRank(a) - muslRank(b);
    if (muslDiff !== 0) {
      return muslDiff;
    }
    return avxRank(a) - avxRank(b);
  });
  return sorted.map((row) => `@oven/${row.bin}`);
}

/**
 * Returns `version` with its final dot-separated numeric component incremented,
 * e.g. `1.3.14` -> `1.3.15`. Used to build a PATH stub that is strictly newer
 * than the bundled Bun. Implemented with string splitting rather than a regex
 * so there is no backtracking risk.
 */
function bumpPatchVersion(version: string): string {
  const parts = version.split('.');
  const patch = parts.pop() ?? '';
  const patchNumber = Number(patch);
  if (!Number.isInteger(patchNumber)) {
    throw new Error(
      `bumpPatchVersion expected a numeric final component, got "${version}"`,
    );
  }
  return [...parts, String(patchNumber + 1)].join('.');
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('issue #2978 @oven fallback — variant ordering (pure)', () => {
  it('matches the upstream table for every realistic host tuple', () => {
    const table = parseUpstreamTable();
    const tuples: ReadonlyArray<{
      readonly os: string;
      readonly arch: 'x64' | 'arm64';
      readonly abi: string | undefined;
      readonly avx2: boolean;
    }> = [
      { os: 'darwin', arch: 'arm64', abi: undefined, avx2: false },
      { os: 'darwin', arch: 'x64', abi: undefined, avx2: true },
      { os: 'darwin', arch: 'x64', abi: undefined, avx2: false },
      { os: 'linux', arch: 'arm64', abi: undefined, avx2: false },
      { os: 'linux', arch: 'arm64', abi: 'musl', avx2: false },
      { os: 'linux', arch: 'x64', abi: undefined, avx2: true },
      { os: 'linux', arch: 'x64', abi: undefined, avx2: false },
      { os: 'linux', arch: 'x64', abi: 'musl', avx2: true },
      { os: 'linux', arch: 'x64', abi: 'musl', avx2: false },
      { os: 'android', arch: 'arm64', abi: 'android', avx2: false },
      { os: 'android', arch: 'x64', abi: 'android', avx2: false },
      { os: 'freebsd', arch: 'arm64', abi: undefined, avx2: false },
      { os: 'freebsd', arch: 'x64', abi: undefined, avx2: false },
      { os: 'win32', arch: 'x64', abi: undefined, avx2: true },
      { os: 'win32', arch: 'x64', abi: undefined, avx2: false },
      { os: 'win32', arch: 'arm64', abi: undefined, avx2: false },
    ];

    for (const tuple of tuples) {
      const host: HostPlatformInput = {
        os: tuple.os,
        arch: tuple.arch,
        abi: tuple.abi as HostPlatformInput['abi'],
        avx2: tuple.avx2,
      };
      const actual = selectOvenVariants(host).map((v) => v.packageName);
      const expected = expectedVariantOrder(
        table,
        tuple.os,
        tuple.arch,
        tuple.abi,
        tuple.avx2,
      );
      expect(actual).toStrictEqual(expected);
    }
  });

  it('orders musl variants before glibc on a musl host', () => {
    const host: HostPlatformInput = {
      os: 'linux',
      arch: 'x64',
      abi: 'musl',
      avx2: true,
    };
    const names = selectOvenVariants(host).map((v) => v.packageName);
    expect(names).toStrictEqual([
      '@oven/bun-linux-x64-musl',
      '@oven/bun-linux-x64-musl-baseline',
      '@oven/bun-linux-x64',
      '@oven/bun-linux-x64-baseline',
    ]);
  });

  it('never lists an avx2 package for a non-avx2 host', () => {
    const table = parseUpstreamTable();
    const avx2Packages = new Set(
      table.filter((r) => r.avx2 === true).map((r) => `@oven/${r.bin}`),
    );
    const hosts: readonly HostPlatformInput[] = [
      { os: 'linux', arch: 'x64', abi: undefined, avx2: false },
      { os: 'linux', arch: 'x64', abi: 'musl', avx2: false },
      { os: 'win32', arch: 'x64', abi: undefined, avx2: false },
      { os: 'darwin', arch: 'x64', abi: undefined, avx2: false },
    ];
    for (const host of hosts) {
      const names = selectOvenVariants(host).map((v) => v.packageName);
      for (const name of names) {
        expect(
          avx2Packages.has(name),
          `${name} is avx2-only but host lacks avx2`,
        ).toBe(false);
      }
    }
  });

  it('probes the platform-correct exe name first, then the other', () => {
    const win = selectOvenVariants({
      os: 'win32',
      arch: 'x64',
      abi: undefined,
      avx2: true,
    });
    expect(win[0].exeNames).toStrictEqual(['bin/bun.exe', 'bin/bun']);

    const linux = selectOvenVariants({
      os: 'linux',
      arch: 'x64',
      abi: undefined,
      avx2: true,
    });
    expect(linux[0].exeNames).toStrictEqual(['bin/bun', 'bin/bun.exe']);
  });
});

describe('issue #2978 @oven fallback — manifest completeness', () => {
  // The publish-integrity test requires every external dep of a shipped
  // workspace to be covered by the ROOT manifest. Asserting BOTH the CLI and
  // the root manifests here locks in the mirror so it cannot drift.
  const manifestPaths = [
    join(repoRoot, 'packages', 'cli', 'package.json'),
    join(repoRoot, 'package.json'),
  ];

  for (const manifestPath of manifestPaths) {
    it(`${manifestPath.replace(repoRoot, '.')} optionalDependencies contains every @oven package at the pin`, () => {
      const table = parseUpstreamTable();
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        readonly optionalDependencies?: Record<string, string>;
        readonly dependencies?: Record<string, string>;
      };
      const optionalDeps = pkg.optionalDependencies ?? {};
      for (const row of table) {
        const name = `@oven/${row.bin}`;
        expect(
          optionalDeps[name],
          `${name} missing from optionalDependencies in ${manifestPath.replace(repoRoot, '.')}`,
        ).toBe(OVEN_PACKAGE_VERSION);
      }
      // Also assert the exported names match the parsed table exactly.
      const parsedNames = table.map((row) => `@oven/${row.bin}`).sort();
      expect([...OVEN_PACKAGE_NAMES].sort()).toStrictEqual(parsedNames);
    });
  }
});

describe('issue #2978 @oven fallback — detection (injectable, no spawn)', () => {
  it('detects linux musl avx2 via injectable callbacks', () => {
    const host = detectHostPlatform({
      platform: 'linux',
      rawArch: 'x64',
      spawnSync: () => ({ stdout: '', status: 0 }),
      readFileSync: () => 'flags: avx2 sse42',
      existsSync: (p) => p === '/etc/alpine-release',
    });
    expect(host).toStrictEqual({
      os: 'linux',
      arch: 'x64',
      abi: 'musl',
      avx2: true,
    });
  });

  it('detects darwin rosetta2 x64 as arm64', () => {
    const host = detectHostPlatform({
      platform: 'darwin',
      rawArch: 'x64',
      spawnSync: (cmd) =>
        cmd === 'sysctl'
          ? { stdout: '1\n', status: 0 }
          : { stdout: '', status: 1 },
      readFileSync: () => '',
      existsSync: () => false,
    });
    expect(host?.arch).toBe('arm64');
  });

  it('detects win32 non-avx2 via PowerShell result', () => {
    const host = detectHostPlatform({
      platform: 'win32',
      rawArch: 'x64',
      spawnSync: () => ({ stdout: 'False', status: 0 }),
      readFileSync: () => '',
      existsSync: () => false,
    });
    expect(host).toStrictEqual({
      os: 'win32',
      arch: 'x64',
      abi: undefined,
      avx2: false,
    });
  });

  it('normalizes arch aliases', () => {
    expect(
      detectHostPlatform({
        platform: 'linux',
        rawArch: 'x86_64',
        spawnSync: () => ({ stdout: '', status: 1 }),
        readFileSync: () => '',
        existsSync: () => false,
      })?.arch,
    ).toBe('x64');
    expect(
      detectHostPlatform({
        platform: 'linux',
        rawArch: 'aarch64',
        spawnSync: () => ({ stdout: '', status: 1 }),
        readFileSync: () => '',
        existsSync: () => false,
      })?.arch,
    ).toBe('arm64');
  });
});

describePosixOnly('issue #2978 @oven fallback — launcher behavior', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-oven-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  itPosix(
    'launches from an npm-v12 layout (bun/bin absent, @oven present)',
    () => {
      const { pkgRoot, launcherTarget } = makeNpmV12Layout(
        tempDir,
        OVEN_ENTRY_CODE,
      );
      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: STANDARD_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      expectNoSpawnError(result);
      expectExitOk(result);
      expect(result.stdout).toContain(OVEN_MARKER);
    },
  );

  itPosix(
    'prefers bundled bun over @oven when both exist (observable via execPath)',
    () => {
      const { pkgRoot, launcherTarget } = makeNpmV12Layout(
        tempDir,
        `console.log(JSON.stringify(process.execPath));`,
      );
      // Now ADD the bundled bun/bin/bun.exe so the bundled candidate wins.
      const bunBinDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
      mkdirSync(bunBinDir, { recursive: true });
      copyFileSync(ensureBun(), join(bunBinDir, 'bun.exe'));

      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: STANDARD_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      expectExitOk(result);
      const execPath = JSON.parse(result.stdout.trim()) as string;
      // The bundled bun path contains node_modules/bun/bin; the @oven path
      // contains @oven. Proving the bundled one was used.
      expect(execPath).toContain('node_modules');
      expect(execPath).toContain('bun');
      expect(execPath).not.toContain('@oven');
    },
  );

  itPosix(
    'rejects an @oven package placed in a consumer ancestor (boundary)',
    () => {
      // Layout: consumer/node_modules/@vybestack/llxprt-code (the package), with
      // NO bun inside the enclosing node_modules. An @oven binary sits in an
      // ancestor ABOVE the enclosing node_modules — must be rejected.
      const consumerDir = join(tempDir, 'consumer');
      const enclosingNm = join(consumerDir, 'node_modules');
      const pkgRoot = join(enclosingNm, '@vybestack', 'llxprt-code');
      const binDir = join(pkgRoot, 'bin');
      mkdirSync(binDir, { recursive: true });
      const launcherTarget = join(binDir, 'llxprt');
      copyFileSync(launcherPath, launcherTarget);
      chmodSync(launcherTarget, 0o755);
      makeEntry(pkgRoot, 'process.exit(0);');

      const bunVersion = realBunVersion();
      writeFileSync(
        join(pkgRoot, 'package.json'),
        JSON.stringify(
          { name: '@vybestack/llxprt-code', dependencies: { bun: bunVersion } },
          null,
          2,
        ),
      );

      // @oven binary in an ancestor (tempDir/node_modules/@oven/...) ABOVE the
      // enclosing node_modules (consumer/node_modules).
      const ancestorNm = join(tempDir, 'node_modules');
      writeOvenPackage(ancestorNm, hostOvenVariant(), bunVersion);

      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: SHORT_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      expectNoSpawnError(result);
      expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
      expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
    },
  );

  itPosix('rejects an @oven package whose version mismatches the pin', () => {
    const { pkgRoot, launcherTarget } = makeNpmV12Layout(
      tempDir,
      OVEN_ENTRY_CODE,
      {
        ovenVersion: '0.0.0-wrong',
      },
    );
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
  });

  itPosix(
    'skips an emptied @oven bin and falls through to a second variant',
    () => {
      const { pkgRoot, launcherTarget } = makeNpmV12Layout(
        tempDir,
        OVEN_ENTRY_CODE,
      );
      // Empty the host variant's bin directory (simulate post-install.js state).
      const variant = hostOvenVariant();
      const pkgDir = join(pkgRoot, 'node_modules', variant.packageName);
      rmSync(join(pkgDir, 'bin'), { recursive: true, force: true });
      mkdirSync(join(pkgDir, 'bin'), { recursive: true });

      // Add a second, valid variant (the baseline sibling) so resolution can
      // recover. The second variant is chosen by taking the next entry from the
      // host's candidate list that is NOT the first.
      const host = detectHostPlatform();
      if (host === null) {
        throw new Error('host detection failed');
      }
      const variants = selectOvenVariants(host);
      const fallback = variants[1] ?? variants[0];
      writeOvenPackage(
        join(pkgRoot, 'node_modules'),
        { packageName: fallback.packageName, exeName: fallback.exeNames[0] },
        realBunVersion(),
      );

      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: STANDARD_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      expectExitOk(result);
      expect(result.stdout).toContain(OVEN_MARKER);
    },
  );

  itPosix(
    'does not exercise @oven detection when bundled bun exists (no-fork)',
    () => {
      // A layout with the bundled bun present must succeed without ever reaching
      // the @oven detection path. We prove this behaviorally: a poisoned @oven
      // directory (non-executable, wrong variant) is present but must NEVER be
      // probed because the bundled bun resolves first.
      const { pkgRoot, launcherTarget } = makePinnedLayout(
        tempDir,
        BUNDLED_ENTRY_CODE,
      );
      // Add a poisoned @oven variant that would fail if probed.
      const variant = hostOvenVariant();
      const ovenPkgDir = join(
        pkgRoot,
        'node_modules',
        variant.packageName,
        'bin',
      );
      mkdirSync(ovenPkgDir, { recursive: true });
      const poisonName = variant.exeName === 'bin/bun.exe' ? 'bun.exe' : 'bun';
      writeFileSync(join(ovenPkgDir, poisonName), 'not a binary');
      // Deliberately NOT chmod +x so any probe fails.

      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: STANDARD_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      expectExitOk(result);
      expect(result.stdout).toContain(BUNDLED_MARKER);
    },
  );

  itNeedsSymlinks(
    'accepts a hoisted @oven binary within enclosing node_modules',
    () => {
      // npm may hoist the @oven package to the enclosing node_modules level.
      const consumerDir = join(tempDir, 'consumer-hoisted');
      const enclosingNm = join(consumerDir, 'node_modules');
      const pkgRoot = join(enclosingNm, '@vybestack', 'llxprt-code');
      const binDir = join(pkgRoot, 'bin');
      mkdirSync(binDir, { recursive: true });
      const launcherTarget = join(binDir, 'llxprt');
      copyFileSync(launcherPath, launcherTarget);
      chmodSync(launcherTarget, 0o755);
      makeEntry(pkgRoot, OVEN_ENTRY_CODE);

      const bunVersion = realBunVersion();
      writeFileSync(
        join(pkgRoot, 'package.json'),
        JSON.stringify(
          { name: '@vybestack/llxprt-code', dependencies: { bun: bunVersion } },
          null,
          2,
        ),
      );

      // Hoisted @oven at the enclosing node_modules level (no bun/bin present).
      writeOvenPackage(enclosingNm, hostOvenVariant(), bunVersion);

      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: STANDARD_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      expectExitOk(result);
      expect(result.stdout).toContain(OVEN_MARKER);
    },
  );

  it.skipIf(process.platform !== 'darwin')(
    'macOS PATH preference still wins over bundled and @oven',
    () => {
      const { pkgRoot, launcherTarget } = makePinnedLayout(
        tempDir,
        BUNDLED_ENTRY_CODE,
      );
      // Add a valid @oven binary so it would be chosen if PATH didn't win.
      writeOvenPackage(join(pkgRoot, 'node_modules'), hostOvenVariant());

      // Stub bun on PATH with a newer version.
      const stubDir = join(tempDir, 'stub-bin');
      mkdirSync(stubDir, { recursive: true });
      const stub = join(stubDir, 'bun');
      const bumped = bumpPatchVersion(realBunVersion());
      writeFileSync(
        stub,
        [
          '#!/bin/sh',
          'if [ "${1:-}" = "--version" ]; then',
          `  printf '%s\\n' '${bumped}'`,
          '  exit 0',
          'fi',
          "printf 'STUB_EXECED\\n'",
          'exit 0',
          '',
        ].join('\n'),
      );
      chmodSync(stub, 0o755);

      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: STANDARD_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: `${stubDir}:/usr/bin:/bin` },
      });
      expectExitOk(result);
      expect(result.stdout).toContain('STUB_EXECED');
      expect(result.stdout).not.toContain(BUNDLED_MARKER);
    },
    15_000,
  );
});

describePosixOnly(
  'issue #2978 @oven fallback — resolveBunExe parity (.cjs)',
  () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'llxprt-resolveBunExe-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('resolves the @oven binary from an npm-v12-shaped layout', () => {
      const { pkgRoot } = makeNpmV12Layout(tempDir, 'process.exit(0);');
      const resolved = installNativeLaunchers._testing.resolveBunExe(pkgRoot);
      if (resolved === null) {
        throw new Error('resolveBunExe returned null for an @oven layout');
      }
      expect(resolved).toContain('@oven');
      expect(existsSync(resolved)).toBe(true);
    });

    it('prefers bundled bun over @oven when both exist', () => {
      const { pkgRoot } = makeNpmV12Layout(tempDir, 'process.exit(0);');
      // Add the bundled binary.
      const bunBinDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
      mkdirSync(bunBinDir, { recursive: true });
      copyFileSync(ensureBun(), join(bunBinDir, 'bun.exe'));

      const resolved = installNativeLaunchers._testing.resolveBunExe(pkgRoot);
      if (resolved === null) {
        throw new Error('resolveBunExe returned null when bundled bun exists');
      }
      expect(resolved).not.toContain('@oven');
      expect(resolved).toContain('bun');
    });
  },
);
