/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { asOptionalRecord, asRecord } from './typed-test-helpers.ts';

const repoRoot = resolve(__dirname, '..', '..');

describe('platform launcher package invariants (issue #2978)', () => {
  // packages/cli MUST declare its own `bin` so that `npm i -g
  // @vybestack/llxprt-code` links the `llxprt` command: npm links ONLY the
  // installed package's own bin entries on a global install, never a
  // dependency's bins. The bin target must be a `#!/usr/bin/env node` shim
  // (bin/llxprt.mjs): npm v12 no longer runs install scripts, so it derives
  // the Windows cmd-shim from the bin target's shebang, and a POSIX #!/bin/sh
  // shebang produces a broken .cmd that invokes /bin/sh (which does not exist
  // on Windows). The two os-gated platform packages that once carried this bin
  // have been removed entirely; the names below survive only so the guard below
  // can prove they are never reintroduced as dependencies.
  const POSIX_PKG = '@vybestack/llxprt-cli-posix';
  const WIN32_PKG = '@vybestack/llxprt-cli-win32';
  const PLATFORM_PKGS = [POSIX_PKG, WIN32_PKG] as const;
  const CLI_BIN_TARGET = 'bin/llxprt.mjs';
  const CLI_BIN_PATH = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt.mjs');

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

  it('packages/cli declares bin.llxprt pointing at the node-shebang shim', () => {
    // A global install links ONLY the installed package's own bin entries, so
    // packages/cli must declare bin.llxprt or `npm i -g @vybestack/llxprt-code`
    // produces no `llxprt` command at all.
    const bin = asOptionalRecord(readCliManifest().bin);
    expect(
      bin?.llxprt,
      'packages/cli must declare bin.llxprt for global installs to work',
    ).toBe(CLI_BIN_TARGET);
    expect(
      existsSync(CLI_BIN_PATH),
      `packages/cli bin target "${CLI_BIN_TARGET}" must exist on disk`,
    ).toBe(true);
  });

  it('the packages/cli bin target uses a #!/usr/bin/env node shebang (not /bin/sh)', () => {
    // Regression guard for the original #2978 bug: npm v12 derives the Windows
    // .cmd/.ps1 shim from the bin target's shebang. A #!/bin/sh shebang yields a
    // broken .cmd that invokes /bin/sh (absent on Windows). A node shebang is
    // handled correctly by cmd-shim on Windows and executes directly on POSIX.
    expect(existsSync(CLI_BIN_PATH)).toBe(true);
    const shebang = readFileSync(CLI_BIN_PATH, 'utf-8')
      .split('\n', 1)[0]
      .trimEnd();
    expect(shebang, 'bin/llxprt.mjs must start with a node shebang').toBe(
      '#!/usr/bin/env node',
    );
    expect(
      shebang,
      'bin/llxprt.mjs must NOT use a /bin/sh shebang (Windows cmd-shim regression)',
    ).not.toContain('/bin/sh');
  });

  it('packages/cli does not depend on the platform launcher packages', () => {
    // Regression guard for a bootstrapping deadlock these packages once caused.
    // They were published only as part of a release, so for any version that
    // had not shipped yet they did not exist on the registry. While packages/cli
    // declared them, no lockfile entry could be generated for them and every
    // workflow running `npm ci` failed with EUSAGE ("Missing: ... from lock
    // file") — which could only be cleared by a release that itself required
    // green CI. bin/llxprt.mjs removes the need for the dependency: it resolves
    // the bundled Bun and launches the CLI entry point on its own.
    const cli = readCliManifest();
    const depFields = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const;
    for (const field of depFields) {
      const deps = asOptionalRecord(cli[field]) ?? {};
      for (const pkg of PLATFORM_PKGS) {
        expect(
          deps[pkg],
          `packages/cli must not declare ${pkg} in ${field}: it is unpublished until a release, which deadlocks npm ci`,
        ).toBeUndefined();
      }
    }
  });
});

describe('node-shebang shim executable bit (issue #2978)', () => {
  // Regression guard: bin/llxprt.mjs was first committed from Windows as mode
  // 100644. npm preserves tarball modes, so a non-executable bin target makes
  // `llxprt` unrunnable on Linux/macOS after install. The git index mode is the
  // invariant that matters, because that is what a Linux checkout (and
  // therefore the published tarball) receives, and it is assertable from any
  // platform.
  it('ships bin/llxprt.mjs with the executable bit set in git', () => {
    const entry = execFileSync(
      'git',
      ['ls-files', '-s', '--', 'packages/cli/bin/llxprt.mjs'],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    expect(entry, 'the shim must be tracked by git').not.toBe('');
    expect(
      entry.split(/\s+/)[0],
      `the shim must be mode 100755, got: ${entry}`,
    ).toBe('100755');
  });
});
