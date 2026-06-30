/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repoRoot = resolve(__dirname, '..', '..');
const realPreinstall = join(repoRoot, 'scripts', 'preinstall.cjs');
const realDetectInstaller = join(repoRoot, 'scripts', 'detect-installer.cjs');

const BUN_USER_AGENT = 'bun/1.3.14 npm/? node/v24.3.0 darwin arm64';
const NPM_USER_AGENT = 'npm/11.6.2 node/v24.3.0 darwin arm64';

// preinstall.cjs only resolves the cleanup directory through
// npm_config_prefix on POSIX as `<prefix>/lib/node_modules/@vybestack`. The
// fixture below builds exactly that layout, which is POSIX-shaped, so the
// suite is skipped on Windows rather than asserting on an unsupported path.
const isWindows = process.platform === 'win32';

const TEMP_DIR_NAMES = ['.llxprt-code-aaaa', '.llxprt-code-bbbb'];
// A sibling that must never be touched: it is the real package directory, not
// an npm atomic-rename staging artifact.
const KEEP_DIR_NAME = 'llxprt-code';

interface RunResult {
  status: number | null;
  stderr: string;
  /** Names remaining under the @vybestack directory after the script runs. */
  remaining: string[];
}

interface Fixture {
  run(opts: { userAgent: string; global: boolean }): RunResult;
}

const fixtures: string[] = [];

/**
 * Builds an isolated fixture reproducing a global-install staging directory:
 * `<prefix>/lib/node_modules/@vybestack` populated with leftover
 * `.llxprt-code-*` temp directories (the ENOTEMPTY artifacts the cleanup
 * targets) plus the real `llxprt-code` package directory that must be
 * preserved. The real preinstall script and its shared detect-installer
 * dependency are copied in so the test exercises the actual files.
 */
function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'preinstall-manager-'));
  fixtures.push(dir);

  mkdirSync(join(dir, 'scripts'));
  copyFileSync(realPreinstall, join(dir, 'scripts', 'preinstall.cjs'));
  copyFileSync(
    realDetectInstaller,
    join(dir, 'scripts', 'detect-installer.cjs'),
  );

  const vybestackDir = join(dir, 'prefix', 'lib', 'node_modules', '@vybestack');
  mkdirSync(vybestackDir, { recursive: true });
  for (const name of TEMP_DIR_NAMES) {
    mkdirSync(join(vybestackDir, name));
    // A nested file makes the directory non-empty, mirroring the real
    // ENOTEMPTY artifacts and ensuring a recursive removal is required.
    writeFileSync(join(vybestackDir, name, 'leftover.txt'), 'x');
  }
  mkdirSync(join(vybestackDir, KEEP_DIR_NAME));
  writeFileSync(join(vybestackDir, KEEP_DIR_NAME, 'package.json'), '{}');

  return {
    run({ userAgent, global }): RunResult {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        npm_config_user_agent: userAgent,
        npm_config_prefix: join(dir, 'prefix'),
      };
      if (global) {
        env.npm_config_global = 'true';
      } else {
        delete env.npm_config_global;
      }

      const result = spawnSync(
        process.execPath,
        [join(dir, 'scripts', 'preinstall.cjs')],
        { encoding: 'utf8', env },
      );

      return {
        status: result.status,
        stderr: result.stderr ?? '',
        remaining: readdirSync(vybestackDir).sort(),
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

describe.skipIf(isWindows)('preinstall package-manager awareness', () => {
  it('does not remove leftover temp directories when Bun drives a global install', () => {
    // Bun never creates the atomic-rename staging artifacts this cleanup
    // targets, so under Bun the script must be a complete no-op even for a
    // global install: every directory, including the temp ones, survives.
    const result = makeFixture().run({
      userAgent: BUN_USER_AGENT,
      global: true,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.remaining).toStrictEqual(
      [...TEMP_DIR_NAMES, KEEP_DIR_NAME].sort(),
    );
  });

  it('removes leftover temp directories when npm drives a global install', () => {
    // Under npm this is the original behavior: the `.llxprt-code-*` staging
    // artifacts are removed while the real package directory is preserved.
    const result = makeFixture().run({
      userAgent: NPM_USER_AGENT,
      global: true,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.remaining).toStrictEqual([KEEP_DIR_NAME]);
  });

  it('leaves temp directories untouched when npm runs a non-global install', () => {
    // The cleanup is scoped to global installs (npm_config_global === 'true').
    // A local install must not touch the staging directory at all, so every
    // entry — temp and real — survives.
    const result = makeFixture().run({
      userAgent: NPM_USER_AGENT,
      global: false,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.remaining).toStrictEqual(
      [...TEMP_DIR_NAMES, KEEP_DIR_NAME].sort(),
    );
  });
});
