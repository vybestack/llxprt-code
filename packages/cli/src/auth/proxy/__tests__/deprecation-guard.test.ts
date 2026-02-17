/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deprecation guard tests for Phase 36.
 *
 * These tests use file-system scans (grep-equivalent) to ensure that:
 * - No direct KeyringTokenStore instantiation exists at consumer sites
 * - No direct getProviderKeyStorage() calls exist at consumer sites
 * - mergeRefreshedToken is not duplicated (only one definition exists)
 * - Factory module is the single entry point for credential stores
 *
 * These behavioral tests prevent re-introduction of deprecated patterns.
 *
 * @plan PLAN-20250214-CREDPROXY.P36
 * @requirement R2.3, R26.1
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Helper to run grep and return matching lines.
 * Returns empty array if no matches (grep exits non-zero).
 */
function grepFiles(
  pattern: string,
  include: string,
  cwd: string,
  excludePatterns: string[] = [],
): string[] {
  const excludeArgs = excludePatterns
    .map((p) => `--exclude-dir=${p}`)
    .join(' ');

  try {
    const cmd = `grep -rn "${pattern}" . --include="${include}" ${excludeArgs} 2>/dev/null || true`;
    const result = execSync(cmd, { cwd, encoding: 'utf-8' });
    return result.split('\n').filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Filter out allowed paths from grep results.
 */
function filterMatches(matches: string[], allowedPaths: string[]): string[] {
  return matches.filter((match) => {
    // Always allow test files
    if (match.includes('.spec.ts') || match.includes('.test.ts')) {
      return false;
    }
    return !allowedPaths.some((allowed) => match.includes(allowed));
  });
}

describe('Deprecation Guards (P36)', () => {
  // __dirname is packages/cli/src/auth/proxy/__tests__
  // Going up 6 levels: __tests__ -> proxy -> auth -> src -> cli -> packages -> project root
  const projectRoot = path.resolve(__dirname, '../../../../../..');
  const packagesRoot = path.resolve(projectRoot, 'packages');
  const cliSrcRoot = path.resolve(projectRoot, 'packages/cli/src');

  describe('R2.3: No Direct KeyringTokenStore Instantiation at Consumer Sites', () => {
    it('should find zero "new KeyringTokenStore" outside allowed locations', () => {
      // Allowed locations:
      // - credential-store-factory.ts (the factory itself)
      // - __tests__/ directories (test files are ok)
      // - proxy/ directory (proxy infrastructure)
      // - node_modules/
      // - dist/

      const matches = grepFiles('new KeyringTokenStore', '*.ts', cliSrcRoot, [
        'node_modules',
        'dist',
        '__tests__',
      ]);

      // Filter out allowed paths
      const allowedPaths = ['credential-store-factory.ts', 'proxy/'];

      const violations = filterMatches(matches, allowedPaths);

      if (violations.length > 0) {
        console.error('Found direct KeyringTokenStore instantiation:');
        violations.forEach((v) => {
          console.error(`  ${v}`);
        });
      }

      expect(violations).toEqual([]);
    });
  });

  describe('R2.3: No Direct getProviderKeyStorage() Calls at Consumer Sites', () => {
    it('should find zero "getProviderKeyStorage()" calls outside allowed locations', () => {
      // Check in cli src - but exclude allowed locations
      const matches = grepFiles('getProviderKeyStorage()', '*.ts', cliSrcRoot, [
        'node_modules',
        'dist',
        '__tests__',
      ]);

      // Allowed locations:
      // - credential-store-factory.ts (the factory itself)
      // - proxy/ directory (proxy infrastructure)
      const allowedPaths = ['credential-store-factory.ts', 'proxy/'];

      const violations = filterMatches(matches, allowedPaths);

      if (violations.length > 0) {
        console.error('Found direct getProviderKeyStorage() calls:');
        violations.forEach((v) => {
          console.error(`  ${v}`);
        });
      }

      expect(violations).toEqual([]);
    });
  });

  describe('R12.5: mergeRefreshedToken Not Duplicated', () => {
    it('should have exactly one function definition of mergeRefreshedToken', () => {
      // Search across all packages for function definitions
      const matches = grepFiles(
        'function mergeRefreshedToken',
        '*.ts',
        packagesRoot,
        ['node_modules', 'dist', '__tests__'],
      );

      // Should find exactly one definition in token-merge.ts
      const definitions = matches.filter((m) =>
        m.includes('export function mergeRefreshedToken'),
      );

      if (definitions.length !== 1) {
        console.error('Expected exactly 1 mergeRefreshedToken definition:');
        definitions.forEach((d) => {
          console.error(`  ${d}`);
        });
      }

      expect(definitions.length).toBe(1);
      expect(definitions[0]).toContain('token-merge.ts');
    });

    it('should not have any "mergeRefreshedToken =" assignments', () => {
      const matches = grepFiles(
        'mergeRefreshedToken[[:space:]]*=',
        '*.ts',
        packagesRoot,
        ['node_modules', 'dist', '__tests__'],
      );

      // Should find zero - no variable assignments creating duplicate implementations
      if (matches.length > 0) {
        console.error('Found mergeRefreshedToken assignments:');
        matches.forEach((m) => {
          console.error(`  ${m}`);
        });
      }

      expect(matches).toEqual([]);
    });
  });

  describe('Factory Module is Single Entry Point', () => {
    it('createTokenStore is exported from credential-store-factory', () => {
      const matches = grepFiles(
        'export function createTokenStore',
        '*.ts',
        cliSrcRoot,
        ['node_modules', 'dist', '__tests__'],
      );

      expect(matches.length).toBe(1);
      expect(matches[0]).toContain('credential-store-factory.ts');
    });

    it('createProviderKeyStorage is exported from credential-store-factory', () => {
      const matches = grepFiles(
        'export function createProviderKeyStorage',
        '*.ts',
        cliSrcRoot,
        ['node_modules', 'dist', '__tests__'],
      );

      expect(matches.length).toBe(1);
      expect(matches[0]).toContain('credential-store-factory.ts');
    });

    it('consumer modules should import from credential-store-factory, not core directly for stores', () => {
      // Key consumer modules that create OAuthManager should use createTokenStore
      // These are: runtimeContextFactory.ts, providerManagerInstance.ts, authCommand.ts
      // Note: oauth-manager.ts is NOT a consumer - it receives TokenStore via constructor DI

      const runtimeMatches = grepFiles(
        'from.*credential-store-factory',
        '*.ts',
        path.resolve(cliSrcRoot, 'runtime'),
        ['node_modules', 'dist', '__tests__'],
      );

      const providerMatches = grepFiles(
        'from.*credential-store-factory',
        '*.ts',
        path.resolve(cliSrcRoot, 'providers'),
        ['node_modules', 'dist', '__tests__'],
      );

      const commandMatches = grepFiles(
        'from.*credential-store-factory',
        '*.ts',
        path.resolve(cliSrcRoot, 'ui/commands'),
        ['node_modules', 'dist', '__tests__'],
      );

      // At least one consumer in each category should use the factory
      const hasRuntimeFactoryImport = runtimeMatches.some((m) =>
        m.includes('runtimeContextFactory.ts'),
      );
      const hasProviderFactoryImport = providerMatches.some((m) =>
        m.includes('providerManagerInstance.ts'),
      );
      const hasCommandFactoryImport = commandMatches.some((m) =>
        m.includes('authCommand.ts'),
      );

      expect(hasRuntimeFactoryImport).toBe(true);
      expect(hasProviderFactoryImport).toBe(true);
      expect(hasCommandFactoryImport).toBe(true);
    });
  });

  describe('R26.1: Non-Sandbox Mode Behavioral Equivalence', () => {
    it('KeyringTokenStore class should still be exported from core for factory use', () => {
      // The class must still be exported from core for the factory to use
      const matches = grepFiles(
        'export.*KeyringTokenStore',
        '*.ts',
        path.resolve(packagesRoot, 'core/src'),
        ['node_modules', 'dist', '__tests__'],
      );

      // Should find the class export
      const classExport = matches.filter(
        (m) =>
          m.includes('export class KeyringTokenStore') ||
          m.includes('export { KeyringTokenStore'),
      );

      expect(classExport.length).toBeGreaterThan(0);
    });

    it('getProviderKeyStorage should still be exported from core for factory use', () => {
      // The function must still be exported from core for the factory to use
      const matches = grepFiles(
        'export function getProviderKeyStorage',
        '*.ts',
        path.resolve(packagesRoot, 'core/src'),
        ['node_modules', 'dist', '__tests__'],
      );

      expect(matches.length).toBe(1);
    });
  });
});
