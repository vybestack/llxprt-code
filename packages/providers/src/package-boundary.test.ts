/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider package scaffold and package-boundary tests.
 *
 * These tests enforce architectural constraints on the providers package scaffold:
 * - Package metadata: name, workspace membership, dependency direction
 * - No provider implementation files in providers package yet (scaffold phase)
 * - Core must not depend on providers package
 * - Provider implementations still live in core (not yet moved)
 * - Anti-shim guards: no V2/Compat/New/Copy patterns, no compatibility re-exports
 *
 * These are behavioral architecture tests — they verify package boundary
 * constraints that prevent circular dependencies and maintain the DAG
 * dependency direction: providers → core, cli → providers + core, core ⊥ providers.
 *
 * @plan:PLAN-20260603-ISSUE1584.P07
 * @requirement:REQ-PKG-001
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const THIS_DIR = __dirname; // packages/providers/src
const PROVIDERS_DIR = path.resolve(THIS_DIR, '..'); // packages/providers
const PACKAGES_DIR = path.resolve(PROVIDERS_DIR, '..'); // packages
const CORE_DIR = path.join(PACKAGES_DIR, 'core');
const CLI_DIR = path.join(PACKAGES_DIR, 'cli');
const ROOT_DIR = path.resolve(PACKAGES_DIR, '..');

/** Pattern matching imports from the providers package (forbidden in core production code) */
const FORBIDDEN_PROVIDERS_IMPORT =
  /from\s+['"]@vybestack\/llxprt-code-providers['"]/;

/** Suffixes indicating compatibility type aliases (forbidden in core) */
const FORBIDDEN_SUFFIXES = ['V2', 'Compat', 'New', 'Copy'];

interface PackageJson {
  name?: string;
  type?: string;
  main?: string;
  types?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
  scripts?: Record<string, string>;
}

interface TsconfigJson {
  compilerOptions?: {
    composite?: boolean;
    paths?: Record<string, string[]>;
  };
  references?: Array<{ path: string }>;
  exclude?: string[];
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

/** Check a .ts file for lines matching a regex, skipping comment lines. */
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

/** Check whether a filename (without .ts extension) has a forbidden compatibility suffix. */
function hasForbiddenSuffix(basename: string): boolean {
  const nameWithoutTestSuffix = basename
    .replace(/\.test$/, '')
    .replace(/\.spec$/, '');
  return FORBIDDEN_SUFFIXES.some((suffix) =>
    nameWithoutTestSuffix.endsWith(suffix),
  );
}

/** Check whether a filename matches compatibility/shim patterns. */
function _hasCompatShimName(basename: string): boolean {
  return /compat/i.test(basename) || /shim/i.test(basename);
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

describe('Provider package metadata constraints', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package.json has correct name @vybestack/llxprt-code-providers', () => {
    const pkg = readJson<PackageJson>(path.join(PROVIDERS_DIR, 'package.json'));
    expect(pkg.name).toBe('@vybestack/llxprt-code-providers');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package.json has core dependency as file:../core', () => {
    const pkg = readJson<PackageJson>(path.join(PROVIDERS_DIR, 'package.json'));
    const deps = pkg.dependencies ?? {};
    expect(deps['@vybestack/llxprt-code-core']).toBe('file:../core');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package.json does not depend on CLI package', () => {
    const pkg = readJson<PackageJson>(path.join(PROVIDERS_DIR, 'package.json'));
    const deps = pkg.dependencies ?? {};
    expect(deps['@vybestack/llxprt-code']).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package.json has main entry pointing to dist/index.js', () => {
    const pkg = readJson<PackageJson>(path.join(PROVIDERS_DIR, 'package.json'));
    expect(pkg.main).toBe('dist/index.js');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package.json has types entry pointing to dist/index.d.ts', () => {
    const pkg = readJson<PackageJson>(path.join(PROVIDERS_DIR, 'package.json'));
    expect(pkg.types).toBe('dist/index.d.ts');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package.json has type: module', () => {
    const pkg = readJson<PackageJson>(path.join(PROVIDERS_DIR, 'package.json'));
    expect(pkg.type).toBe('module');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package.json has build, test, typecheck, and lint scripts', () => {
    const pkg = readJson<PackageJson>(path.join(PROVIDERS_DIR, 'package.json'));
    const scripts = pkg.scripts ?? {};
    expect(scripts['build']).toBeDefined();
    expect(scripts['test']).toBeDefined();
    expect(scripts['typecheck']).toBeDefined();
    expect(scripts['lint']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// Workspace membership
// ─────────────────────────────────────────────────────────────────

describe('Workspace membership constraints', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('root package.json includes packages/providers in workspaces', () => {
    const pkg = readJson<PackageJson>(path.join(ROOT_DIR, 'package.json'));
    const workspaces = pkg.workspaces ?? [];
    expect(workspaces).toContain('packages/providers');
  });
});

// ─────────────────────────────────────────────────────────────────
// Dependency direction: core MUST NOT depend on providers
// ─────────────────────────────────────────────────────────────────

describe('Core must not depend on providers package', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('core package.json has no providers dependency', () => {
    const pkg = readJson<PackageJson>(path.join(CORE_DIR, 'package.json'));
    const deps = pkg.dependencies ?? {};
    expect(deps['@vybestack/llxprt-code-providers']).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('core tsconfig.json has no providers references', () => {
    const tsconfigPath = path.join(CORE_DIR, 'tsconfig.json');
    expect(fs.existsSync(tsconfigPath)).toBe(true);
    const tsconfig = readJson<TsconfigJson>(tsconfigPath);
    const references = tsconfig.references ?? [];
    const hasProvidersRef = references.some((ref) =>
      ref.path.includes('providers'),
    );
    expect(hasProvidersRef).toBe(false);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   *
   * Core production source must never import from the providers package.
   * This scan checks non-test .ts files in core/src for forbidden imports.
   */
  it('core production source has no imports from providers package', () => {
    const coreSrc = path.join(CORE_DIR, 'src');
    const files = collectTsFiles(coreSrc, true); // exclude tests
    const violations: string[] = [];

    for (const filePath of files) {
      const rel = path.relative(coreSrc, filePath);
      const matches = findViolatingLines(
        filePath,
        FORBIDDEN_PROVIDERS_IMPORT,
        rel,
      );
      violations.push(...matches);
    }

    expect(violations).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// CLI dependency constraints (P07 scope: CLI does NOT yet depend on providers)
// ─────────────────────────────────────────────────────────────────

describe('CLI dependency constraints (P11 — providers dependency present)', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   *
   * In the current scaffold phase, CLI has not yet been migrated to import
   * from providers. This test documents the current state. When P14 migrates
   * CLI imports, this test should be updated to assert that CLI DOES
   * depend on providers.
   */
  it('CLI package.json depends on providers after provider move wiring', () => {
    const pkg = readJson<PackageJson>(path.join(CLI_DIR, 'package.json'));
    const deps = pkg.dependencies ?? {};
    expect(deps['@vybestack/llxprt-code-providers']).toBe('file:../providers');
  });
});

// ─────────────────────────────────────────────────────────────────
// Scaffold state: no provider implementation files in providers package yet
// ─────────────────────────────────────────────────────────────────

describe('Provider implementations moved to providers package (P11)', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P11
   * @requirement:REQ-PKG-001
   */
  it('providers/src contains moved provider implementation files', () => {
    const keyFiles = [
      'IProvider.ts',
      'IProviderManager.ts',
      'ProviderManager.ts',
      'ITool.ts',
      'ProviderContentGenerator.ts',
    ];
    for (const file of keyFiles) {
      expect(fs.existsSync(path.join(PROVIDERS_DIR, 'src', file))).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P11
   * @requirement:REQ-PKG-001
   */
  it('providers/src contains concrete provider implementation subdirectories', () => {
    const srcDir = path.join(PROVIDERS_DIR, 'src');
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    const dirs = new Set(
      entries
        .filter((e: fs.Dirent) => e.isDirectory())
        .map((e: fs.Dirent) => e.name),
    );
    for (const subdir of ['openai', 'anthropic', 'gemini', 'fake']) {
      expect(dirs.has(subdir)).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P11
   * @requirement:REQ-SHIM-001
   */
  it('core/src/providers no longer contains provider implementations', () => {
    const coreProvidersDir = path.join(CORE_DIR, 'src', 'providers');
    expect(fs.existsSync(coreProvidersDir)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Anti-shim guards: core must not add compatibility re-exports
// ─────────────────────────────────────────────────────────────────

describe('Anti-shim: core must not add compatibility re-exports from providers', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   *
   * Core must NOT import from the @vybestack/llxprt-code-providers package
   * in production code. This is the anti-cycle constraint: providers depends
   * on core, not the other way around.
   *
   * Note: Core re-exports from './providers/...' (its own internal directory)
   * are the current pre-migration state. These will be removed in P15.
   * P07 only guards against imports from the new providers PACKAGE.
   */
  it('core index.ts must not import from @vybestack/llxprt-code-providers', () => {
    const coreIndexPath = path.join(CORE_DIR, 'src', 'index.ts');
    expect(fs.existsSync(coreIndexPath)).toBe(true);
    const content = fs.readFileSync(coreIndexPath, 'utf-8');

    // Only check for @vybestack/llxprt-code-providers imports - not from './providers/'
    // which is the current internal core directory (pre-migration state)
    expect(content.match(FORBIDDEN_PROVIDERS_IMPORT)).toBeNull();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   *
   * No V2/Compat/New/Copy suffixed provider contract types in core.
   * Per anti-shim policy, these naming patterns indicate compatibility
   * shims that should not exist.
   */
  it('no V2/Compat/New/Copy suffixed provider contract files in core', () => {
    const coreSrc = path.join(CORE_DIR, 'src');
    const allTsFiles = collectTsFiles(coreSrc, false); // include test files for completeness
    const violations = allTsFiles
      .filter((filePath) => {
        const rel = path.relative(coreSrc, filePath);
        return (
          !rel.includes('boundary-guards.test.ts') &&
          !rel.includes('package-boundary.test.ts')
        );
      })
      .filter((filePath) => hasForbiddenSuffix(path.basename(filePath, '.ts')))
      .map(
        (filePath) =>
          `${path.relative(coreSrc, filePath)} uses forbidden suffix`,
      );

    expect(violations).toHaveLength(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   *
   * Checks that no "compat" or "shim" files exist in core/src/providers/.
   * These would indicate compatibility wrappers that would violate the
   * anti-shim policy.
   *
   * Note: LoggingProviderWrapper is a legitimate pre-existing provider
   * implementation (decorator pattern for logging), not a compatibility
   * shim. It is excluded from this check.
   */
  it('no core/src/providers compatibility shim directory remains after P11', () => {
    const coreProvidersDir = path.join(CORE_DIR, 'src', 'providers');
    expect(fs.existsSync(coreProvidersDir)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// TypeScript configuration constraints
// ─────────────────────────────────────────────────────────────────

describe('TypeScript configuration constraints', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P11
   * @requirement:REQ-PKG-001
   */
  it('providers tsconfig.json does not compile core sources as a composite project', () => {
    const tsconfig = readJson<TsconfigJson>(
      path.join(PROVIDERS_DIR, 'tsconfig.json'),
    );
    expect(tsconfig.compilerOptions?.composite).toBe(false);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers tsconfig.json has path alias for @vybestack/llxprt-code-providers', () => {
    const tsconfig = readJson<TsconfigJson>(
      path.join(PROVIDERS_DIR, 'tsconfig.json'),
    );
    const paths = tsconfig.compilerOptions?.paths;
    expect(paths).toBeDefined();
    expect(paths?.['@vybestack/llxprt-code-providers']).toBeDefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers tsconfig.json excludes test files from compilation', () => {
    const tsconfig = readJson<TsconfigJson>(
      path.join(PROVIDERS_DIR, 'tsconfig.json'),
    );
    const excludes = tsconfig.exclude ?? [];
    const hasTestExclude = excludes.some(
      (e: string) => e.includes('.test.ts') || e.includes('.spec.ts'),
    );
    expect(hasTestExclude).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// Package build configuration
// ─────────────────────────────────────────────────────────────────

describe('Provider package build configuration', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   *
   * Verify the providers package has the required configuration files
   * that enable it to build, test, and lint as a workspace member.
   */
  it('providers package has vitest.config.ts', () => {
    expect(fs.existsSync(path.join(PROVIDERS_DIR, 'vitest.config.ts'))).toBe(
      true,
    );
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package has test-setup.ts', () => {
    expect(fs.existsSync(path.join(PROVIDERS_DIR, 'test-setup.ts'))).toBe(true);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package has index.ts entry point', () => {
    expect(fs.existsSync(path.join(PROVIDERS_DIR, 'index.ts'))).toBe(true);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P07
   * @requirement:REQ-PKG-001
   */
  it('providers package has src/index.ts source entry point', () => {
    expect(fs.existsSync(path.join(PROVIDERS_DIR, 'src', 'index.ts'))).toBe(
      true,
    );
  });
});
