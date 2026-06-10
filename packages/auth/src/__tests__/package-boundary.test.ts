/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auth package scaffold and package-boundary tests.
 *
 * These tests enforce architectural constraints on the auth package scaffold:
 * - Package metadata: name, workspace membership, dependency direction
 * - Public API: import resolves, placeholder exports exist
 * - Dependency isolation: production code MUST NOT import from
 *   core/cli/providers/tools (REQ-DEP-001.2)
 * - Anti-shim guards: no V2/Compat/New/Copy patterns
 * - Auth appears before core in root workspaces array (DAG constraint)
 *
 * These are behavioral architecture tests — they verify package boundary
 * constraints that prevent circular dependencies and maintain the DAG
 * dependency direction: auth ⊥, core → auth, providers → auth + core.
 *
 * @plan:PLAN-20260608-ISSUE1586.P04
 * @requirement:REQ-DEP-001.2
 * @requirement:REQ-AUTH-001.3
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const THIS_DIR = __dirname; // packages/auth/src/__tests__
const SRC_DIR = path.resolve(THIS_DIR, '..'); // packages/auth/src
const AUTH_DIR = path.resolve(SRC_DIR, '..'); // packages/auth
const PACKAGES_DIR = path.resolve(AUTH_DIR, '..'); // packages
const CORE_DIR = path.join(PACKAGES_DIR, 'core');
const ROOT_DIR = path.resolve(PACKAGES_DIR, '..');

/** Canonical import specifiers forbidden in auth production code. */
const FORBIDDEN_IMPORTS = [
  /from\s+['"]@vybestack\/llxprt-code-core['"]/,
  /from\s+['"]@vybestack\/llxprt-code-cli['"]/,
  /from\s+['"]@vybestack\/llxprt-code-providers['"]/,
  /from\s+['"]@vybestack\/llxprt-code-tools['"]/,
  /from\s+['"]@vybestack\/llxprt-code['"]/,
];

/** Relative-path escapes forbidden in auth production code. */
const FORBIDDEN_RELATIVE_ESCAPES = /\.\.\/\.\.\/\.\./;

/** Suffixes indicating compatibility type aliases (forbidden). */
const FORBIDDEN_SUFFIXES = ['V2', 'Compat', 'New', 'Copy'];

interface PackageJson {
  name?: string;
  type?: string;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  files?: string[];
}

/**
 * Helper: recursively collect .ts files in a directory, optionally excluding tests.
 */
function collectTsFiles(dir: string, excludeTests = true): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath, excludeTests));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (
        excludeTests &&
        (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))
      ) {
        continue;
      }
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Check a .ts file for lines matching a regex, skipping comment lines.
 */
function findViolatingLines(
  filePath: string,
  pattern: RegExp,
  relPath: string,
): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    if (
      trimmedLine.startsWith('//') ||
      trimmedLine.startsWith('*') ||
      trimmedLine.startsWith('/*')
    ) {
      continue;
    }
    if (pattern.test(lines[i])) {
      violations.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
    }
  }
  return violations;
}

/**
 * Helper: read and parse a JSON file with typed result.
 */
function readJson<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

// ─────────────────────────────────────────────────────────────────
// Package metadata constraints
// ─────────────────────────────────────────────────────────────────

describe('Auth package metadata constraints', () => {
  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   */
  it('auth package.json has correct name @vybestack/llxprt-code-auth', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    expect(pkg.name).toBe('@vybestack/llxprt-code-auth');
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   */
  it('auth package.json has type: module', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    expect(pkg.type).toBe('module');
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   */
  it('auth package.json has main entry pointing to dist/index.js', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    expect(pkg.main).toBe('dist/index.js');
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   */
  it('auth package.json has types entry pointing to dist/index.d.ts', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    expect(pkg.types).toBe('dist/index.d.ts');
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   */
  it('auth package.json has exports with types and import conditions', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    const exports = pkg.exports as Record<string, Record<string, string>>;
    expect(exports['.']).toBeDefined();
    expect(exports['.'].types).toBe('./dist/index.d.ts');
    expect(exports['.'].import).toBe('./dist/index.js');
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   */
  it('auth package.json has build, test, typecheck scripts', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    const scripts = pkg.scripts ?? {};
    expect(scripts['build']).toBeDefined();
    expect(scripts['test']).toBeDefined();
    expect(scripts['typecheck']).toBeDefined();
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   */
  it('auth package.json has NO @vybestack/* in dependencies', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    const deps = pkg.dependencies ?? {};
    for (const depName of Object.keys(deps)) {
      expect(depName).not.toMatch(/^@vybestack\//);
    }
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   */
  it('auth package.json has NO @vybestack/* in devDependencies', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    const devDeps = pkg.devDependencies ?? {};
    for (const depName of Object.keys(devDeps)) {
      expect(depName).not.toMatch(/^@vybestack\//);
    }
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   */
  it('auth package.json files field includes dist only', () => {
    const pkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    expect(pkg.files).toStrictEqual(['dist']);
  });
});

// ─────────────────────────────────────────────────────────────────
// Public API / import resolution
// ─────────────────────────────────────────────────────────────────

describe('Auth package public API', () => {
  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   *
   * Verify the package can be imported. Even though it is a placeholder scaffold,
   * the import must resolve without error.
   */
  it('import(@vybestack/llxprt-code-auth) resolves', async () => {
    const mod = await import('@vybestack/llxprt-code-auth');
    expect(mod).toBeDefined();
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   *
   * The scaffold is currently a placeholder. This test documents that the module
   * exports an object (even if empty). Once interfaces are added in P06+,
   * specific named exports will be tested.
   */
  it('auth package module is an object (placeholder scaffold)', async () => {
    const mod = await import('@vybestack/llxprt-code-auth');
    expect(typeof mod).toBe('object');
  });
});

// ─────────────────────────────────────────────────────────────────
// Dependency isolation: forbidden imports in production code
// ─────────────────────────────────────────────────────────────────

describe('Auth package dependency isolation', () => {
  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   *
   * Auth production code MUST NOT import from core/cli/providers/tools.
   * This scan checks all non-test .ts files in packages/auth/src.
   *
   * In the scaffold phase (P04), this should pass trivially since
   * no production code exists yet. Once auth source files are added
   * in P09+, this test becomes the enforcement mechanism.
   */
  it('production code has no forbidden @vybestack/* imports', () => {
    const prodFiles = collectTsFiles(SRC_DIR, true);

    const violations: string[] = [];

    for (const filePath of prodFiles) {
      const relPath = path.relative(AUTH_DIR, filePath);
      for (const pattern of FORBIDDEN_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden imports found in auth production code:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   *
   * Auth production code MUST NOT use relative-path escapes (../../../)
   * that reach outside the auth package boundary.
   */
  it('production code has no relative-path escapes', () => {
    const prodFiles = collectTsFiles(SRC_DIR, true);

    const violations: string[] = [];

    for (const filePath of prodFiles) {
      const relPath = path.relative(AUTH_DIR, filePath);
      violations.push(
        ...findViolatingLines(filePath, FORBIDDEN_RELATIVE_ESCAPES, relPath),
      );
    }

    expect(
      violations,
      `Forbidden relative-path escapes in auth production code:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Anti-shim guards
// ─────────────────────────────────────────────────────────────────

describe('Auth package anti-shim guards', () => {
  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   *
   * No file in auth package should have V2/Compat/New/Copy suffixes
   * indicating compatibility shims or duplicate types.
   */
  it('no .ts files have forbidden compatibility suffixes', () => {
    const allFiles = collectTsFiles(AUTH_DIR, false);
    const violations: string[] = [];

    for (const filePath of allFiles) {
      const basename = path.basename(filePath, '.ts');
      const nameWithoutTestSuffix = basename
        .replace(/\.test$/, '')
        .replace(/\.spec$/, '');

      if (
        FORBIDDEN_SUFFIXES.some((suffix) =>
          nameWithoutTestSuffix.endsWith(suffix),
        )
      ) {
        violations.push(path.relative(AUTH_DIR, filePath));
      }
    }

    expect(
      violations,
      `Files with forbidden compatibility suffixes:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Workspace DAG constraints
// ─────────────────────────────────────────────────────────────────

describe('Auth workspace DAG constraints', () => {
  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   *
   * packages/auth MUST appear before packages/core in the root workspaces array.
   * This ensures auth is a leaf dependency (⊥) — it depends on nothing from
   * the monorepo, while core depends on auth.
   */
  it('auth appears before core in root workspaces array', () => {
    const rootPkg = readJson<{ workspaces?: string[] }>(
      path.join(ROOT_DIR, 'package.json'),
    );
    const workspaces = rootPkg.workspaces ?? [];
    const authIndex = workspaces.indexOf('packages/auth');
    const coreIndex = workspaces.indexOf('packages/core');

    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(authIndex).toBeLessThan(coreIndex);
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   *
   * Core MUST have auth as a dependency (core → auth direction).
   */
  it('core package has @vybestack/llxprt-code-auth as dependency', () => {
    const corePkg = readJson<PackageJson>(path.join(CORE_DIR, 'package.json'));
    const deps = corePkg.dependencies ?? {};
    expect(deps['@vybestack/llxprt-code-auth']).toBeDefined();
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   *
   * Core package.json has tsconfig paths alias for auth.
   */
  it('core has @vybestack/llxprt-code-auth tsconfig paths alias', () => {
    const tsconfigPath = path.join(CORE_DIR, 'tsconfig.json');
    expect(fs.existsSync(tsconfigPath)).toBe(true);
    const tsconfig = readJson<{
      compilerOptions?: { paths?: Record<string, string[]> };
    }>(tsconfigPath);
    const paths = tsconfig.compilerOptions?.paths ?? {};
    expect(paths['@vybestack/llxprt-code-auth']).toBeDefined();
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-DEP-001.2
   *
   * Auth package.json does NOT depend on core (leaf dependency).
   */
  it('auth does not depend on core package', () => {
    const authPkg = readJson<PackageJson>(path.join(AUTH_DIR, 'package.json'));
    const deps = authPkg.dependencies ?? {};
    expect(deps['@vybestack/llxprt-code-core']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// Build artifact checks
// ─────────────────────────────────────────────────────────────────

describe('Auth package build artifacts', () => {
  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   */
  it('dist/index.js exists', () => {
    expect(fs.existsSync(path.join(AUTH_DIR, 'dist', 'index.js'))).toBe(true);
  });

  /**
   * @plan:PLAN-20260608-ISSUE1586.P04
   * @requirement:REQ-AUTH-001.3
   */
  it('dist/index.d.ts exists', () => {
    expect(fs.existsSync(path.join(AUTH_DIR, 'dist', 'index.d.ts'))).toBe(true);
  });
});
