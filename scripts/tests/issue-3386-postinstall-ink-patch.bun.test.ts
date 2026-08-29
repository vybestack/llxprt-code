/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface NpmInvocationModule {
  npmInvocation(args: readonly string[]): { command: string; args: string[] };
}

interface Installer {
  readonly name: 'npm' | 'bun';
  readonly installCommand: string;
  readonly installArgs: readonly string[];
  readonly lifecycleCommand: string;
  readonly lifecycleArgs: readonly string[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nodeRequire = createRequire(import.meta.url);
const npmModule: unknown = nodeRequire('../lib/npm-command.cjs');

function isNpmInvocationModule(value: unknown): value is NpmInvocationModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'npmInvocation' in value &&
    typeof value.npmInvocation === 'function'
  );
}

if (!isNpmInvocationModule(npmModule)) {
  throw new Error('npm-command.cjs does not export npmInvocation');
}

function resolveExecutable(name: 'bun' | 'node'): string {
  const executable = Bun.which(name);
  if (executable === null) {
    throw new Error(`${name} executable is required for this test`);
  }
  return executable;
}

function installers(): readonly Installer[] {
  const npm = npmModule.npmInvocation([]);
  const bun = resolveExecutable('bun');
  return [
    {
      name: 'npm',
      installCommand: npm.command,
      installArgs: [
        ...npm.args,
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      lifecycleCommand: npm.command,
      lifecycleArgs: [...npm.args, 'run', 'postinstall'],
    },
    {
      name: 'bun',
      installCommand: bun,
      installArgs: ['install', '--ignore-scripts'],
      lifecycleCommand: bun,
      lifecycleArgs: ['run', 'postinstall'],
    },
  ];
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  timeout: number,
): ReturnType<typeof spawnSync> {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: process.env.PATH,
      BUN_INSTALL_CACHE_DIR: join(cwd, '.bun-install-cache'),
    },
  });
}

const behavioralGuard = `
const measure = await import('./node_modules/ink/build/measure-text.js');
if (
  measure.internal_memoryRetentionPatchVersion !== 2 ||
  typeof measure.internal_resetToStyledCharactersCache !== 'function' ||
  typeof measure.internal_getToStyledCharactersCacheStats !== 'function'
) {
  console.error('PATCH_REQUIRED');
  process.exit(42);
}
measure.internal_resetToStyledCharactersCache();
for (let index = 0; index < 512; index++) {
  const fill = String.fromCharCode(33 + (index % 90));
  const text = (String(index) + ':').padEnd(512, fill);
  measure.toStyledCharacters(text);
}
const stats = measure.internal_getToStyledCharactersCacheStats();
if (
  stats.entryCount > 10000 ||
  stats.dataSize > 65536 ||
  stats.styledCharacterCells > 65536
) {
  console.error(JSON.stringify(stats));
  process.exit(43);
}
`;

describe('issue #3386 real postinstall Ink patch application', () => {
  for (const installer of installers()) {
    it(`turns fresh stock Ink into a bounded cache after a ${installer.name} install`, () => {
      const packageRoot = mkdtempSync(
        join(tmpdir(), `llxprt-3386-${installer.name}-`),
      );
      try {
        mkdirSync(join(packageRoot, 'scripts'), { recursive: true });
        mkdirSync(join(packageRoot, 'patches'), { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify(
            {
              name: `issue-3386-${installer.name}-patch-proof`,
              private: true,
              scripts: { postinstall: 'node scripts/postinstall.cjs' },
              dependencies: {
                ink: 'npm:@jrichman/ink@6.4.8',
                'patch-package': '8.0.1',
              },
            },
            null,
            2,
          ),
        );
        copyFileSync(
          join(repoRoot, 'scripts', 'postinstall.cjs'),
          join(packageRoot, 'scripts', 'postinstall.cjs'),
        );
        copyFileSync(
          join(repoRoot, 'scripts', 'detect-installer.cjs'),
          join(packageRoot, 'scripts', 'detect-installer.cjs'),
        );
        copyFileSync(
          join(repoRoot, 'patches', 'ink+6.4.8.patch'),
          join(packageRoot, 'patches', 'ink+6.4.8.patch'),
        );
        writeFileSync(join(packageRoot, 'check.mjs'), behavioralGuard);

        const install = run(
          installer.installCommand,
          installer.installArgs,
          packageRoot,
          120_000,
        );
        expect(install.error).toBeUndefined();
        expect(install.status).toBe(0);

        const stock = run(
          resolveExecutable('bun'),
          ['check.mjs'],
          packageRoot,
          30_000,
        );
        expect(stock.status).toBe(42);

        const patch = run(
          installer.lifecycleCommand,
          installer.lifecycleArgs,
          packageRoot,
          60_000,
        );
        expect(patch.error).toBeUndefined();
        expect(patch.status).toBe(0);

        const patched = run(
          resolveExecutable('bun'),
          ['check.mjs'],
          packageRoot,
          30_000,
        );
        expect(patched.error).toBeUndefined();
        expect(patched.status).toBe(0);
      } finally {
        rmSync(packageRoot, { recursive: true, force: true });
      }
    }, 180_000);
  }
});
