/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for scripts/check-config-boundary.ts (issue #2615, P03).
 *
 * Pins the seven behaviours from
 * project-plans/issue2615/plan/03-boundary-guard-tdd.md using REAL fixture files
 * in a temp dir (no filesystem mocking). Each fixture mirrors the monorepo
 * layout (packages/<pkg>/package.json + source) so the guard's TypeScript
 * compiler program resolves cross-package types exactly as it does on the real
 * repo. The guard runs as a subprocess so exit codes and printed output are
 * asserted directly (true behaviour, not implementation details).
 *
 * Tests are written BEFORE the implementation exists and fail naturally against
 * the missing script (subprocess error / wrong exit code), never via a
 * NotYetImplemented placeholder.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_DIR = import.meta.dir;
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
const GUARD = join(REPO_ROOT, 'scripts', 'check-config-boundary.ts');
const RUNTIME = process.env.BUN_EXECUTABLE ?? 'bun';

/** Relative import specifier for a consumer living directly under a package src/. */
const CORE_SPEC = '@vybestack/llxprt-code-core';

interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the guard subprocess against a fixture root, capturing exit + output. */
function runGuard(
  root: string,
  extraArgs: readonly string[] = [],
): GuardResult {
  try {
    const stdout = execFileSync(
      RUNTIME,
      [GUARD, '--root', root, ...extraArgs],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return classifyRunError(error);
  }
}

function classifyRunError(error: unknown): GuardResult {
  const spawn = error as SpawnSyncReturns<Buffer>;
  const stdout =
    typeof spawn.stdout === 'string'
      ? spawn.stdout
      : (spawn.stdout ?? Buffer.alloc(0)).toString('utf8');
  const stderr =
    typeof spawn.stderr === 'string'
      ? spawn.stderr
      : (spawn.stderr ?? Buffer.alloc(0)).toString('utf8');
  const code = typeof spawn.status === 'number' ? spawn.status : 1;
  return { code, stdout, stderr };
}

/**
 * Shared temp-directory helper (RULES.md "DRY setup"). Registers its own
 * lifecycle hooks and returns a lazy accessor.
 */
function useTempDir(): () => string {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'config-boundary-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    if (dir === '') {
      throw new Error('Temp directory accessed outside its lifecycle');
    }
    return dir;
  };
}

function writePackageJson(pkgDir: string, name: string): void {
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name }));
}

/** Scaffolds a minimal core package exporting a Config class with members. */
function scaffoldCore(root: string): void {
  writePackageJson(join(root, 'packages/core'), '@vybestack/llxprt-code-core');
  mkdirSync(join(root, 'packages/core/src/config'), { recursive: true });
  writeFileSync(
    join(root, 'packages/core/index.ts'),
    `export { Config } from './src/config/config.js';\n`,
  );
  writeFileSync(
    join(root, 'packages/core/src/config/config.ts'),
    `export class Config {
  constructor(params?: Record<string, unknown>) {}
  getSessionId(): string {
    return '';
  }
  getModel(): string {
    return '';
  }
  getToolRegistry(): unknown {
    return null;
  }
}
`,
  );
}

function writeConsumer(
  root: string,
  pkg: string,
  file: string,
  content: string,
): string {
  const dir = join(root, 'packages', pkg, 'src');
  mkdirSync(dir, { recursive: true });
  writePackageJson(
    join(root, 'packages', pkg),
    `@vybestack/llxprt-code-${pkg}`,
  );
  const rel = `packages/${pkg}/src/${file}`;
  writeFileSync(join(dir, file), content);
  return rel;
}

describe('config-boundary guard', () => {
  const getDir = useTempDir();

  it('flags production files importing the Config type in every import form', () => {
    const root = getDir();
    scaffoldCore(root);
    const typeImport = writeConsumer(
      root,
      'agents',
      'typeImport.ts',
      `import type { Config } from '${CORE_SPEC}';
export function use(c: Config): string {
  return c.getSessionId();
}
`,
    );
    const valueImport = writeConsumer(
      root,
      'providers',
      'valueImport.ts',
      `import { Config } from '${CORE_SPEC}';
export function use(c: Config): string {
  return c.getModel();
}
`,
    );
    const inlineTypeImport = writeConsumer(
      root,
      'mcp',
      'inlineTypeImport.ts',
      `import { type Config } from '${CORE_SPEC}';
export function use(c: Config): string {
  return c.getSessionId();
}
`,
    );
    const renamedImport = writeConsumer(
      root,
      'cli',
      'renamedImport.ts',
      `import { Config as AppConfig } from '${CORE_SPEC}';
export function use(c: AppConfig): string {
  return c.getModel();
}
`,
    );

    const result = runGuard(root);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(typeImport);
    expect(result.stdout).toContain(valueImport);
    expect(result.stdout).toContain(inlineTypeImport);
    expect(result.stdout).toContain(renamedImport);
  });

  it('does not flag a file inside packages/core', () => {
    const root = getDir();
    scaffoldCore(root);
    const coreConsumerRel = 'packages/core/src/internal/user.ts';
    mkdirSync(join(root, 'packages/core/src/internal'), { recursive: true });
    writeFileSync(
      join(root, coreConsumerRel),
      `import { Config } from '../config/config.js';
export function use(c: Config): string {
  return c.getSessionId();
}
`,
    );

    const result = runGuard(root, ['--enforce']);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain(coreConsumerRel);
  });

  it('does not flag a file that constructs new Config(...) (factory)', () => {
    const root = getDir();
    scaffoldCore(root);
    const factoryRel = writeConsumer(
      root,
      'agents',
      'factory.ts',
      `import { Config } from '${CORE_SPEC}';
export function build(): Config {
  return new Config();
}
`,
    );

    const result = runGuard(root, ['--enforce']);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain(factoryRel);
  });

  it('does not flag test files', () => {
    const root = getDir();
    scaffoldCore(root);
    const dotTest = writeConsumer(
      root,
      'agents',
      'thing.test.ts',
      `import { Config } from '${CORE_SPEC}';
export function use(c: Config): string {
  return c.getSessionId();
}
`,
    );
    const specFile = writeConsumer(
      root,
      'agents',
      'thing.spec.ts',
      `import { Config } from '${CORE_SPEC}';
export function use(c: Config): string {
  return c.getModel();
}
`,
    );
    mkdirSync(join(root, 'packages/agents/src/__tests__'), { recursive: true });
    const testsDir = 'packages/agents/src/__tests__/helper.ts';
    writeFileSync(
      join(root, testsDir),
      `import { Config } from '${CORE_SPEC}';
export function use(c: Config): string {
  return c.getSessionId();
}
`,
    );
    mkdirSync(join(root, 'packages/agents/test-bun'), { recursive: true });
    const bunDir = 'packages/agents/test-bun/runner.bun.ts';
    writeFileSync(
      join(root, bunDir),
      `import { Config } from '${CORE_SPEC}';
export function use(c: Config): string {
  return c.getModel();
}
`,
    );

    const result = runGuard(root, ['--enforce']);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain(dotTest);
    expect(result.stdout).not.toContain(specFile);
    expect(result.stdout).not.toContain(testsDir);
    expect(result.stdout).not.toContain(bunDir);
  });

  it('flags a role interface declaring a service-locator member (REQ-004)', () => {
    const root = getDir();
    scaffoldCore(root);
    const rolesDir = join(root, 'packages/core/src/config/roles');
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(
      join(rolesDir, 'sessionIdentity.ts'),
      `export interface SessionIdentity {
  getSessionId(): string;
  getToolManager(): unknown;
}
`,
    );

    const result = runGuard(root);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('getToolManager');
    expect(result.stdout).toContain('roles/sessionIdentity.ts');
  });

  it('exits 0 in report-only and 1 in enforce when a finding exists', () => {
    const root = getDir();
    scaffoldCore(root);
    writeConsumer(
      root,
      'agents',
      'violator.ts',
      `import { Config } from '${CORE_SPEC}';
export function use(c: Config): string {
  return c.getSessionId();
}
`,
    );

    const reportOnly = runGuard(root);
    expect(reportOnly.code).toBe(0);

    const enforce = runGuard(root, ['--enforce']);
    expect(enforce.code).toBe(1);
  });

  it('fails closed (non-zero) on a parse error rather than silently passing', () => {
    const root = getDir();
    scaffoldCore(root);
    writeConsumer(
      root,
      'agents',
      'broken.ts',
      `import { Config } from '${CORE_SPEC}';
export function use(c: Config {   // <- syntax error: missing )
  return c.getSessionId();
`,
    );

    const result = runGuard(root);

    expect(result.code).not.toBe(0);
  });
});
