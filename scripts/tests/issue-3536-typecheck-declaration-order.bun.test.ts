/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3536: typecheck must not depend on prior build output. Workspace
 * resolution maps cli -> tools, core -> mcp, and a2a -> storage to dist
 * declarations, so those declarations must be regenerated before checking.
 * Reading the real root package.json pins the command callers actually run.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative, resolve } from 'node:path';
import { DECLARATIONS_ONLY_ENV } from '../build_package.ts';

const repoRoot = resolve(import.meta.dir, '..', '..');

function prepareBuildFixture(fixtureRoot: string): string {
  const packageDir = join(fixtureRoot, 'packages', 'fixture');
  mkdirSync(join(packageDir, 'src'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
  copyFileSync(
    join(repoRoot, 'scripts', 'copy_files.ts'),
    join(fixtureRoot, 'scripts', 'copy_files.ts'),
  );
  writeFileSync(
    join(packageDir, 'src', 'index.ts'),
    'export const answer: number = 42;\n',
  );
  writeFileSync(
    join(packageDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        module: 'NodeNext',
        moduleResolution: 'nodenext',
        rootDir: 'src',
        outDir: 'dist',
        declaration: true,
        composite: true,
        strict: true,
        types: [],
      },
      include: ['src/**/*.ts'],
    }),
  );
  return packageDir;
}

function runBuildPackage(
  packageDir: string,
  declarationsOnly: boolean,
): { status: number | null; output: string; distFiles: string[] } {
  const env = { ...process.env };
  if (declarationsOnly) {
    env[DECLARATIONS_ONLY_ENV] = '1';
  } else {
    delete env[DECLARATIONS_ONLY_ENV];
  }
  env['PATH'] =
    `${join(repoRoot, 'node_modules', '.bin')}${delimiter}${env['PATH'] ?? ''}`;
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'build_package.ts')],
    { cwd: packageDir, encoding: 'utf8', env, timeout: 180_000 },
  );
  const distDir = join(packageDir, 'dist');
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    distFiles: existsSync(distDir)
      ? readdirSync(distDir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => relative(distDir, join(entry.parentPath, entry.name)))
      : [],
  };
}

function rootPackageScript(name: string): string {
  const pkg: unknown = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  );
  if (typeof pkg !== 'object' || pkg === null || !('scripts' in pkg)) {
    throw new Error('Root package.json must contain scripts');
  }
  const scripts = pkg.scripts;
  if (typeof scripts !== 'object' || scripts === null || !(name in scripts)) {
    throw new Error(`Root package.json must contain scripts.${name}`);
  }
  const script: unknown = Reflect.get(scripts, name);
  if (typeof script !== 'string') {
    throw new Error(`Root package.json scripts.${name} must be a string`);
  }
  return script;
}

describe('issue #3536 typecheck declaration ordering', () => {
  it('exists as a string in the root package scripts', () => {
    expect(typeof rootPackageScript('typecheck')).toBe('string');
  });

  it('chains exactly four commands with fail-fast separators', () => {
    const script = rootPackageScript('typecheck');
    expect(script.split('&&')).toHaveLength(4);
    expect(script).not.toContain('||');
    expect(script).not.toContain(';');
  });

  it('generates declarations as the first command', () => {
    const segments = rootPackageScript('typecheck')
      .split('&&')
      .map((segment) => segment.trim());
    expect(segments[0]).toBe('npm run build:types');
  });

  it('checks workspaces, scripts, and evals after declaration generation', () => {
    const script = rootPackageScript('typecheck');
    const buildIndex = script.indexOf('build:types');
    const workspaceIndex = script.indexOf('typecheck --workspaces');
    const scriptsIndex = script.indexOf('tsconfig.scripts.json');
    const evalsIndex = script.indexOf('evals/tsconfig.json');

    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(workspaceIndex).toBeGreaterThan(buildIndex);
    expect(scriptsIndex).toBeGreaterThan(workspaceIndex);
    expect(evalsIndex).toBeGreaterThan(scriptsIndex);
  });

  it('keeps build:types on the declaration-only build path', () => {
    const script = rootPackageScript('build:types');
    expect(script).toContain(`${DECLARATIONS_ONLY_ENV}=1`);
    expect(script).toContain('npm run build');
  });
});

describe('issue #3536 non-destructive declaration build pipeline', () => {
  it('a declaration-only build preserves the JavaScript of a prior full build', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'issue-3536-pipeline-'));
    try {
      const packageDir = prepareBuildFixture(fixtureRoot);
      const fullBuild = runBuildPackage(packageDir, false);
      expect(fullBuild.status, fullBuild.output).toBe(0);
      expect(fullBuild.distFiles).toContain('index.js');

      const declarations = runBuildPackage(packageDir, true);

      expect(declarations.status, declarations.output).toBe(0);
      expect(declarations.distFiles).toContain('index.d.ts');
      expect(declarations.distFiles).toContain('index.js');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 240_000);

  it('a declaration-only build regenerates declarations when dist is absent', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'issue-3536-pipeline-'));
    try {
      const packageDir = prepareBuildFixture(fixtureRoot);
      const fullBuild = runBuildPackage(packageDir, false);
      expect(fullBuild.status, fullBuild.output).toBe(0);
      expect(fullBuild.distFiles).toContain('index.js');
      rmSync(join(packageDir, 'dist'), { recursive: true, force: true });

      const declarations = runBuildPackage(packageDir, true);

      expect(declarations.status, declarations.output).toBe(0);
      expect(declarations.distFiles).toContain('index.d.ts');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 240_000);

  it('a full build re-emits over a stale dist artifact (#3536 full-build clean preservation)', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'issue-3536-pipeline-'));
    try {
      const packageDir = prepareBuildFixture(fixtureRoot);
      const firstBuild = runBuildPackage(packageDir, false);
      expect(firstBuild.status, firstBuild.output).toBe(0);
      expect(firstBuild.distFiles).toContain('index.js');

      // A stale artifact left in dist by an earlier build. Without the full
      // mode's `tsc --build --clean` pre-step, the surviving .tsbuildinfo
      // makes plain `tsc --build` skip emission and the stale content would
      // survive the run, so fresh content proves the clean still executes.
      writeFileSync(
        join(packageDir, 'dist', 'index.js'),
        'export const answer = -1; // stale\n',
      );

      const fullBuild = runBuildPackage(packageDir, false);

      expect(fullBuild.status, fullBuild.output).toBe(0);
      expect(fullBuild.distFiles).toContain('index.js');
      expect(
        readFileSync(join(packageDir, 'dist', 'index.js'), 'utf8'),
      ).toContain('42');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 240_000);
});
