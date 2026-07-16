/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');

interface PackageJson {
  version: string;
  scripts?: Record<string, string>;
}

function readRootPackageJson(): PackageJson {
  const packageJsonPath = resolve(repoRoot, 'package.json');
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
  } catch (error) {
    throw new Error(`Failed to load ${packageJsonPath}`, { cause: error });
  }
}

const rootPkg = readRootPackageJson();

function expectScriptDefined(
  scripts: Record<string, string>,
  key: string,
): string {
  const command = scripts[key];
  if (command === undefined) {
    throw new Error(`package.json scripts.${key} must be defined`);
  }
  return command;
}

describe('Issue #2342: Bun-native cross-platform dev launcher', () => {
  describe('package.json script configuration', () => {
    const scripts = rootPkg.scripts ?? {};

    it('start launches packages/cli/index.ts directly via bun with preload, no forbidden relay, Windows-safe', () => {
      const start = expectScriptDefined(scripts, 'start');
      expect(start).toContain('bun');
      expect(start).toContain('packages/cli/index.ts');
      expect(start).toContain('--preload');
      expect(start).toContain('scripts/dev-env.ts');
      expect(start).not.toContain('cross-env');
      expect(start).not.toContain('scripts/start.ts');
      expect(start).not.toContain('llxprt.cjs');
      expect(start).not.toMatch(/\bnode\b/);
      expect(
        start,
        'start must not use a POSIX leading KEY=value assignment (breaks Windows cmd)',
      ).not.toMatch(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s/);
    });

    it('prestart runs the Bun-native generation lifecycle', () => {
      const prestart = expectScriptDefined(scripts, 'prestart');
      expect(prestart).toBe('bun run generate');
      expect(expectScriptDefined(scripts, 'generate')).toBe(
        'bun scripts/generate-git-commit-info.ts && bun scripts/generate_prompt_manifest.ts',
      );
    });

    it('debug remains on scripts/start.ts for inspector/sandbox semantics', () => {
      const debug = expectScriptDefined(scripts, 'debug');
      expect(debug).toContain('scripts/start.ts');
    });
  });
});

function findBunExecutableForRuntimeTest(): string {
  const result = spawnSync('bun', ['--version'], {
    encoding: 'utf-8',
  });
  if (result.error || result.status !== 0) {
    return '';
  }
  return 'bun';
}

const realBunForRuntimeTest = findBunExecutableForRuntimeTest();
const runtimeDescribe = realBunForRuntimeTest ? describe : describe.skip;

const VERSION_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

runtimeDescribe('Issue #2342: runtime behavior', () => {
  it('bun run start --version prints a version and exits 0', () => {
    const result = spawnSync(
      realBunForRuntimeTest,
      ['run', 'start', '--version'],
      {
        cwd: repoRoot,
        timeout: 60_000,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      },
    );
    if (result.error) {
      const isTimeout =
        'code' in result.error && result.error.code === 'ETIMEDOUT';
      throw new Error(
        isTimeout
          ? 'bun run start did not exit within 60s'
          : `Failed to spawn bun run start: ${result.error.message}`,
      );
    }
    expect(
      result.status,
      `bun run start exited ${result.status}. stderr:\n${result.stderr ?? ''}`,
    ).toBe(0);
    expect((result.stdout ?? '').trim()).toMatch(VERSION_REGEX);
  }, 60_000);

  it('preload module sets DEV=true and NODE_ENV=development under Bun', () => {
    const devEnvPath = resolve(repoRoot, 'scripts', 'dev-env.ts');
    const result = spawnSync(
      realBunForRuntimeTest,
      [
        '--preload',
        devEnvPath,
        '-e',
        'console.log(JSON.stringify({ CLI_VERSION: process.env.CLI_VERSION, DEV: process.env.DEV, NODE_ENV: process.env.NODE_ENV }))',
      ],
      {
        cwd: repoRoot,
        timeout: 30_000,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      },
    );
    if (result.error) {
      throw new Error(
        `Failed to spawn bun preload test: ${result.error.message}`,
      );
    }
    expect(result.status, `stderr:\n${result.stderr ?? ''}`).toBe(0);
    const raw = (result.stdout ?? '').trim();
    expect(raw, 'preload test produced no stdout').not.toBe('');
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toEqual({
      CLI_VERSION: rootPkg.version,
      DEV: 'true',
      NODE_ENV: 'development',
    });
  }, 30_000);
});
