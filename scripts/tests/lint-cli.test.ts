/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';

const ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/lint.ts');
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// scripts/lint.ts resolves actionlint and shellcheck download targets at module
// load and only maps linux and darwin, throwing
// "Unsupported platform/architecture: win32/x64" before any of its own logic
// runs. Both tools are POSIX-oriented, so the script has no Windows support to
// exercise and this suite cannot run there.
describe.skipIf(process.platform === 'win32')(
  'lint.ts tsconfig validation',
  () => {
    it('fails fast and identifies non-string exclude entries', () => {
      const directory = mkdtempSync(join(tmpdir(), 'lint-tsconfig-'));
      tempDirectories.push(directory);
      const packageDirectory = join(directory, 'packages', 'fixture');
      mkdirSync(packageDirectory, { recursive: true });
      writeFileSync(
        join(packageDirectory, 'tsconfig.json'),
        JSON.stringify({ exclude: ['node_modules', 42, null] }),
      );
      const init = spawnSync('git', ['init', '--quiet'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(init.status, init.stderr).toBe(0);
      const add = spawnSync('git', ['add', 'packages/fixture/tsconfig.json'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(add.status, add.stderr).toBe(0);

      const result = spawnSync(process.execPath, [SCRIPT, '--tsconfig'], {
        cwd: directory,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('invalid items: [42,null]');
    });
  },
);
