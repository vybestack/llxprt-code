/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { asOptionalRecord, asRecord, asString } from './typed-test-helpers.ts';

const repoRoot = resolve(__dirname, '..', '..');

describe('platform launcher package invariants (issue #2978)', () => {
  // The `llxprt` bin was moved out of packages/cli and into two os-gated
  // platform packages (@vybestack/llxprt-cli-posix and -win32). npm v12 no
  // longer runs install scripts, so npm derives the Windows cmd-shim from the
  // bin target's shebang; a POSIX #!/bin/sh shebang produces a broken .cmd
  // that invokes /bin/sh. Shipping an os-appropriate bin target per platform
  // fixes this, but ONLY while packages/cli declares no bin of its own
  // (otherwise npm re-derives the broken shim from packages/cli/bin/llxprt) and
  // the two platform packages stay in exact lockstep with packages/cli.
  const POSIX_PKG = '@vybestack/llxprt-cli-posix';
  const WIN32_PKG = '@vybestack/llxprt-cli-win32';
  const PLATFORM_PKGS = [POSIX_PKG, WIN32_PKG] as const;

  function readCliManifest(): Record<string, unknown> {
    return asRecord(
      JSON.parse(
        readFileSync(
          join(repoRoot, 'packages', 'cli', 'package.json'),
          'utf-8',
        ),
      ),
    );
  }

  function readManifest(dir: string): Record<string, unknown> {
    return asRecord(
      JSON.parse(
        readFileSync(join(repoRoot, 'packages', dir, 'package.json'), 'utf-8'),
      ),
    );
  }

  it('packages/cli declares no bin field', () => {
    // If packages/cli declared a bin, npm would derive a shim from its
    // shebang and reproduce the Windows /bin/sh regression.
    expect(readCliManifest().bin).toBeUndefined();
  });

  it('packages/cli pins both platform packages as exact optionalDependencies', () => {
    const cli = readCliManifest();
    const optionalDeps = asOptionalRecord(cli.optionalDependencies) ?? {};
    for (const pkg of PLATFORM_PKGS) {
      const spec = asString(optionalDeps[pkg]);
      // An exact pin starts with a digit; a range operator (^, ~, >, <, *, x)
      // would let npm resolve a different version and silently break the
      // os-gated launcher contract.
      const first = spec.charAt(0);
      expect(
        first >= '0' && first <= '9',
        `packages/cli optionalDependencies.${pkg} must be an exact version (got "${spec}")`,
      ).toBe(true);
    }
  });

  it('platform package versions are in exact lockstep with packages/cli', () => {
    // A version skew would silently leave consumers with no `llxprt` command:
    // the parent's optionalDependencies pin an exact version that does not
    // exist on the registry, so the platform package is skipped at install.
    const cli = readCliManifest();
    const cliVersion = asString(cli.version);
    const optionalDeps = asOptionalRecord(cli.optionalDependencies) ?? {};
    for (const pkg of PLATFORM_PKGS) {
      expect(
        optionalDeps[pkg],
        `${pkg} pin must exist in packages/cli optionalDependencies`,
      ).toBeDefined();
      expect(optionalDeps[pkg]).toBe(cliVersion);
    }

    // The launcher packages are intentionally not workspaces (issue #2978), so
    // version.ts bumps their own version field explicitly. That field must also
    // equal the cli version, or the exact pin above would target a registry
    // version that does not exist and npm would skip the platform package.
    const launcherDirForPkg: Record<string, string> = {
      [POSIX_PKG]: 'llxprt-cli-posix',
      [WIN32_PKG]: 'llxprt-cli-win32',
    };
    for (const pkg of PLATFORM_PKGS) {
      expect(
        asString(readManifest(launcherDirForPkg[pkg]).version),
        `${pkg} own version must equal packages/cli's version`,
      ).toBe(cliVersion);
    }
  });

  it.each([
    {
      dir: 'llxprt-cli-posix',
      pkg: POSIX_PKG,
      os: ['darwin', 'linux', 'freebsd'],
      binTarget: 'bin/llxprt',
    },
    {
      dir: 'llxprt-cli-win32',
      pkg: WIN32_PKG,
      os: ['win32'],
      binTarget: 'bin/llxprt.cmd',
    },
  ])(
    '$pkg declares bin.llxprt, the correct exclusive os, and ships its bin target',
    ({ dir, pkg, os, binTarget }) => {
      const manifest = readManifest(dir);
      expect(manifest.name).toBe(pkg);
      const bin = asOptionalRecord(manifest.bin);
      expect(bin?.llxprt, `${pkg} must declare bin.llxprt`).toBeDefined();
      expect(bin?.llxprt).toBe(binTarget);
      // Pinning the exact os array enforces mutually-exclusive install targets
      // (POSIX set vs win32) so the two never both install on one machine.
      expect(manifest.os).toEqual(os);
      expect(
        existsSync(join(repoRoot, 'packages', dir, binTarget)),
        `${pkg} bin target "${binTarget}" must exist on disk`,
      ).toBe(true);
    },
  );
});

describe('platform launcher executable bit (issue #2978)', () => {
  // Regression guard: the POSIX launcher was first committed from Windows as
  // mode 100644. npm preserves tarball modes, so a non-executable bin script
  // makes `llxprt` unrunnable on Linux/macOS after install — the exact failure
  // this package exists to prevent. The git index mode is the invariant that
  // matters, because that is what a Linux checkout (and therefore the published
  // tarball) receives, and it is assertable from any platform.
  it('ships the POSIX launcher with the executable bit set in git', () => {
    const entry = execFileSync(
      'git',
      ['ls-files', '-s', '--', 'packages/llxprt-cli-posix/bin/llxprt'],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    expect(entry, 'POSIX launcher must be tracked by git').not.toBe('');
    expect(
      entry.split(/\s+/)[0],
      `POSIX launcher must be mode 100755, got: ${entry}`,
    ).toBe('100755');
  });
});
