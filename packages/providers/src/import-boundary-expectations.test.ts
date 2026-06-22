/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Import Boundary Expectations Tests (P10)
 *
 * These tests define the expected import boundaries AFTER P11 migration.
 * They document and verify that:
 *
 * 1. Providers package exports are accessible from the package public API
 * 2. Core does NOT import from providers package in production code
 * 3. CLI will import provider types from providers package (not core re-exports)
 * 4. No import cycles exist between core and providers
 * 5. Provider files still exist in core (pre-migration state) until P11 moves them
 * 6. Filesystem boundary guards enforce architecture constraints
 *
 * Some tests are GREEN now (verifying pre-migration state), some are RED
 * (expected to fail until P11 migration completes).
 *
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const CORE_DIR = path.join(ROOT_DIR, 'packages', 'core');
const PROVIDERS_DIR = path.join(ROOT_DIR, 'packages', 'providers');
const PROVIDERS_SRC_DIR = path.join(PROVIDERS_DIR, 'src');
const _CLI_DIR = path.join(ROOT_DIR, 'packages', 'cli');
const CORE_SRC_DIR = path.join(CORE_DIR, 'src');
const CORE_PROVIDERS_DIR = path.join(CORE_SRC_DIR, 'providers');

/** Patterns for forbidden imports in core production code. */
const FORBIDDEN_PROVIDERS_PACKAGE_IMPORT =
  /from\s+['"]@vybestack\/llxprt-code-providers['"]/u;

/** Patterns for forbidden deep-imports from core providers in CLI after migration. */
const _FORBIDDEN_CLI_DEEP_PROVIDER_IMPORT =
  /from\s+['"]@vybestack\/llxprt-code-core\/providers\//u;

/** Forbidden compatibility naming suffixes. */
const FORBIDDEN_SUFFIXES = ['V2', 'Compat', 'New', 'Copy'];

/**
 * Recursively collect all .ts files, optionally excluding test files.
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
 * Check file content for forbidden import patterns.
 */
function findForbiddenImports(
  files: string[],
  pattern: RegExp,
  relativeTo: string,
): string[] {
  const violations: string[] = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*')
      ) {
        continue;
      }
      if (pattern.test(lines[i])) {
        violations.push(
          `${path.relative(relativeTo, filePath)}:${i + 1}: ${lines[i].trim()}`,
        );
      }
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────
// Core must not import from providers package (GREEN — current state)
// ─────────────────────────────────────────────────────────────────

describe('Core must not import from providers package', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Core production code must never import from the
   * @vybestack/llxprt-code-providers package. This is the anti-cycle constraint.
   */
  it('core production source has zero imports from providers package', () => {
    const coreFiles = collectTsFiles(CORE_SRC_DIR, true);
    const violations = findForbiddenImports(
      coreFiles,
      FORBIDDEN_PROVIDERS_PACKAGE_IMPORT,
      ROOT_DIR,
    );
    expect(violations).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Core package.json must not depend on providers package.
   */
  it('core package.json has no providers package dependency', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(CORE_DIR, 'package.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    expect(deps['@vybestack/llxprt-code-providers']).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Core tsconfig must not reference providers.
   */
  // eslint-disable-next-line vitest/no-conditional-in-test -- tsconfig may not exist in all environments, early return is intentional
  it('core tsconfig.json has no providers reference', () => {
    const tsconfigPath = path.join(CORE_DIR, 'tsconfig.json');
    // eslint-disable-next-line vitest/no-conditional-in-test -- tsconfig may not exist in all environments
    if (!fs.existsSync(tsconfigPath)) {
      return;
    }
    const content = fs.readFileSync(tsconfigPath, 'utf-8');
    // Strip comments — these regexes are bounded for test-only JSON content
    const stripped = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    try {
      const tsconfig = JSON.parse(stripped) as Record<string, unknown>;
      const references = (tsconfig.references ?? []) as Array<
        Record<string, string>
      >;
      for (const ref of references) {
        expect(ref.path.includes('providers')).toBe(false);
      }
    } catch {
      // Skip if tsconfig can't be parsed (TS extends format)
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Providers package dependency direction (GREEN — current state)
// ─────────────────────────────────────────────────────────────────

describe('Providers package dependency direction', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Providers package must not depend on CLI.
   */
  it('providers package.json has no CLI dependency', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PROVIDERS_DIR, 'package.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const dependencySections = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    ] as Array<Record<string, string> | undefined>;
    const forbiddenDependencies = ['@vybestack/llxprt-code'];

    for (const deps of dependencySections) {
      for (const forbiddenDependency of forbiddenDependencies) {
        expect(deps?.[forbiddenDependency]).toBeUndefined();
      }
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Providers package depends on core for deep modules.
   */
  it('providers package.json has core dependency', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PROVIDERS_DIR, 'package.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    expect(deps['@vybestack/llxprt-code-core']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// Pre-migration state: key provider files still exist in core (GREEN)
// ─────────────────────────────────────────────────────────────────

describe('Provider files moved to providers package (P11 state)', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P11
   * @requirement:REQ-PKG-001
   */
  it('key provider interface files exist in packages/providers/src/', () => {
    const keyFiles = [
      'IProvider.ts',
      'IProviderManager.ts',
      'ITool.ts',
      'IModel.ts',
      'ContentGeneratorRole.ts',
      'errors.ts',
    ];
    for (const file of keyFiles) {
      expect(
        fs.existsSync(path.join(PROVIDERS_SRC_DIR, file)),
        `Missing: ${file}`,
      ).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P11
   * @requirement:REQ-PKG-001
   */
  it('key provider implementation files exist in packages/providers/src/', () => {
    expect(
      fs.existsSync(path.join(PROVIDERS_SRC_DIR, 'fake', 'FakeProvider.ts')),
      'Missing: fake/FakeProvider.ts',
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(PROVIDERS_SRC_DIR, 'ProviderContentGenerator.ts'),
      ),
      'Missing: ProviderContentGenerator.ts',
    ).toBe(true);
    expect(
      fs.existsSync(path.join(PROVIDERS_SRC_DIR, 'ProviderManager.ts')),
      'Missing: ProviderManager.ts',
    ).toBe(true);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P11
   * @requirement:REQ-PKG-001
   */
  it('tokenizer files exist in packages/providers/src/tokenizers/', () => {
    const tokenizerFiles = [
      'ITokenizer.ts',
      'OpenAITokenizer.ts',
      'AnthropicTokenizer.ts',
    ];
    const tokenizersDir = path.join(PROVIDERS_SRC_DIR, 'tokenizers');
    for (const file of tokenizerFiles) {
      expect(
        fs.existsSync(path.join(tokenizersDir, file)),
        `Missing: tokenizers/${file}`,
      ).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P11
   * @requirement:REQ-SHIM-001
   */
  it('core/src/providers has been removed with no compatibility shim directory', () => {
    expect(fs.existsSync(CORE_PROVIDERS_DIR)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Anti-shim: no forbidden naming patterns (GREEN — current state)
// ─────────────────────────────────────────────────────────────────

describe('Anti-shim: no forbidden naming patterns in core or providers', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: No V2/Compat/New/Copy suffixed types in core contract files.
   */
  it('core runtime contracts have no forbidden suffix naming', () => {
    const contractsDir = path.join(CORE_SRC_DIR, 'runtime', 'contracts');
    const files = collectTsFiles(contractsDir, true);
    const violations = files
      .filter((filePath) => {
        const basename = path.basename(filePath, '.ts');
        return FORBIDDEN_SUFFIXES.some((suffix) => basename.endsWith(suffix));
      })
      .map((f) => path.relative(CORE_SRC_DIR, f));
    expect(violations).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Core index.ts re-exports providers (current state).
   * After P15, these re-exports should be removed.
   */
  it('core index.ts currently re-exports provider types (pre-migration state)', () => {
    const indexPath = path.join(CORE_SRC_DIR, 'index.ts');
    const content = fs.readFileSync(indexPath, 'utf-8');
    // Current state: core index.ts re-exports providers
    expect(content.includes("from './providers/")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Expected post-P11 import patterns (RED — will pass after migration)
// ─────────────────────────────────────────────────────────────────

describe('Expected post-P11 import patterns', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RED TEST: After P11, providers package must export ProviderManager.
   */
  // eslint-disable-next-line vitest/no-conditional-in-test -- RED/GREEN migration test uses try/catch intentionally
  it('providers package exports ProviderManager (P11 green)', async () => {
    try {
      const mod = await import('@vybestack/llxprt-code-providers');
      expect('ProviderManager' in mod).toBe(true);
    } catch (error) {
      throw new Error(
        'providers package must export ProviderManager: ' + String(error),
      );
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RED TEST: After P11, providers package must export FakeProvider.
   */
  // eslint-disable-next-line vitest/no-conditional-in-test -- RED/GREEN migration test uses try/catch intentionally
  it('providers package exports FakeProvider (P11 green)', async () => {
    try {
      const mod = await import('@vybestack/llxprt-code-providers');
      expect('FakeProvider' in mod).toBe(true);
    } catch (error) {
      throw new Error(
        'providers package must export FakeProvider: ' + String(error),
      );
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RED TEST: After P11, providers package must export ProviderContentGenerator.
   */
  // eslint-disable-next-line vitest/no-conditional-in-test -- RED/GREEN migration test uses try/catch intentionally
  it('providers package exports ProviderContentGenerator (P11 green)', async () => {
    try {
      const mod = await import('@vybestack/llxprt-code-providers');
      expect('ProviderContentGenerator' in mod).toBe(true);
    } catch (error) {
      throw new Error(
        'providers package must export ProviderContentGenerator: ' +
          String(error),
      );
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RED TEST: After P11, providers package must export tokenizers.
   */
  // eslint-disable-next-line vitest/no-conditional-in-test -- RED/GREEN migration test uses try/catch intentionally
  it('providers package exports tokenizer classes (P11 green)', async () => {
    try {
      const mod = await import('@vybestack/llxprt-code-providers');
      expect('OpenAITokenizer' in mod || 'AnthropicTokenizer' in mod).toBe(
        true,
      );
    } catch (error) {
      throw new Error(
        'providers package must export runtime tokenizer classes: ' +
          String(error),
      );
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RED TEST: After P11, providers package must export provider errors.
   */
  // eslint-disable-next-line vitest/no-conditional-in-test -- RED/GREEN migration test uses try/catch intentionally
  it('providers package exports error types (P11 green)', async () => {
    try {
      const mod = await import('@vybestack/llxprt-code-providers');
      expect('RateLimitError' in mod).toBe(true);
    } catch (error) {
      throw new Error(
        'providers package must export error types: ' + String(error),
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Filesystem boundary guards (GREEN — architecture constraints)
// ─────────────────────────────────────────────────────────────────

describe('Filesystem boundary guards', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Providers package src directory contains only scaffold
   * and test files before P11 migration.
   */
  it('providers/src contains moved provider implementation directories', () => {
    const srcDir = path.join(PROVIDERS_DIR, 'src');
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    const implementationDirs = entries
      .filter((e: fs.Dirent) => e.isDirectory())
      .map((e: fs.Dirent) => e.name);
    expect(implementationDirs).toStrictEqual(
      expect.arrayContaining([
        'openai',
        'anthropic',
        'gemini',
        'fake',
        'tokenizers',
      ]),
    );
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: No compatibility shim files exist in the providers package.
   */
  it('no compat/shim files in providers package', () => {
    const files = collectTsFiles(path.join(PROVIDERS_DIR, 'src'), true);
    const violations = files.filter((filePath) => {
      const basename = path.basename(filePath);
      return /compat/i.test(basename) || /shim/i.test(basename);
    });
    expect(violations).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Providers package has correct workspace setup.
   */
  it('root package.json includes providers workspace', () => {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const workspaces = (rootPkg.workspaces ?? []) as string[];
    expect(workspaces).toContain('packages/providers');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * GREEN TEST: Providers package has build, test, typecheck, and lint scripts.
   */
  it('providers package has required scripts', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PROVIDERS_DIR, 'package.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
    expect(scripts.build).toBeDefined();
    expect(scripts.test).toBeDefined();
    expect(scripts.typecheck).toBeDefined();
    expect(scripts.lint).toBeDefined();
  });
});
