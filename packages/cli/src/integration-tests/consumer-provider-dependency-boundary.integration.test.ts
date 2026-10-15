/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';

import * as fs from 'node:fs';

import * as path from 'node:path';

describe('explicit provider primitive owners', () => {
  describe('provider behavior', () => {
    const managerReleases: Array<() => void | Promise<void>> = [];

    afterEach(async () => {
      const failures: unknown[] = [];
      for (const release of managerReleases.splice(0).reverse()) {
        try {
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Provider owner cleanup failed');
    });

    // ─────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────

    /**
     * @plan:PLAN-20260603-ISSUE1584.P13
     * @requirement:REQ-API-001
     *
     * Creates a minimal IProvider for testing. Uses real interface shape,
     * not mocked — verifies actual provider behavior through structural
     * conformance.
     */

    // ─────────────────────────────────────────────────────────────────
    // Requirement 4: Core index/no-shim boundary
    // ─────────────────────────────────────────────────────────────────

    /**
     * @plan:PLAN-20260603-ISSUE1584.P13
     * @requirement:REQ-API-001
     *
     * Core index must not re-export provider symbols and core production
     * code must not import from the providers package. These are
     * behavioral boundary tests that would fail if a provider re-export
     * or forbidden import was accidentally added.
     */

    describe('Core no-shim and dependency-direction boundary', () => {
      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * Core index.ts must not import from @vybestack/llxprt-code-providers.
       * This prevents provider re-exports from core.
       */
      function coreIndexImportsProvidersPackage(): boolean {
        const coreIndexPath = path.resolve(
          __dirname,
          '../../../core/src/index.ts',
        );
        const content = fs.readFileSync(coreIndexPath, 'utf-8');
        const hasProvidersPackageImport =
          content.includes("from '@vybestack/llxprt-code-providers'") ||
          content.includes("from '@vybestack/llxprt-code-providers/") ||
          content.includes('from "@vybestack/llxprt-code-providers"') ||
          content.includes('from "@vybestack/llxprt-code-providers/');

        return hasProvidersPackageImport;
      }

      it('core index.ts has no imports from providers package', () => {
        // No import from the providers package
        const hasProvidersPackageImport = coreIndexImportsProvidersPackage();
        try {
          expect(hasProvidersPackageImport).toBe(false);
        } catch (error) {
          throw new Error(
            'core index.ts must not import from @vybestack/llxprt-code-providers',
            { cause: error },
          );
        }
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * Core index.ts must not re-export provider-owned symbols like
       * IProvider, ProviderManager, ProviderContentGenerator, etc.
       */
      function findProviderSymbolReExports(): ReadonlyArray<{
        readonly pattern: RegExp;
        readonly match: RegExpMatchArray | null;
      }> {
        const coreIndexPath = path.resolve(
          __dirname,
          '../../../core/src/index.ts',
        );
        const content = fs.readFileSync(coreIndexPath, 'utf-8');

        // No re-export of provider-owned symbols
        const providerSymbolReExports = [
          /export.*\bIProvider\b/,
          /export.*\bProviderManager\b/,
          /export.*\bProviderContentGenerator\b/,
          /export.*\bFakeProvider\b/,
          /export.*\bOpenAIProvider\b/,
          /export.*\bAnthropicProvider\b/,
          /export.*\bGeminiProvider\b/,
          /export.*\bContentGeneratorRole\b/,
          /export.*\bOpenAITokenizer\b/,
          /export.*\bAnthropicTokenizer\b/,
          /export.*\bRateLimitError\b/,
          /export.*\bQuotaError\b/,
          /export.*\bAuthenticationError\b/,
        ];

        // Allow the pattern only in comments
        const lines = content.split('\n');
        const codeLines = lines.filter(
          (line) =>
            !line.trim().startsWith('//') && !line.trim().startsWith('*'),
        );
        const codeContent = codeLines.join('\n');
        return providerSymbolReExports.map((pattern) => ({
          pattern,
          match: codeContent.match(pattern),
        }));
      }

      it('core index.ts has no re-exports of provider-owned symbols', () => {
        const providerSymbolReExports = findProviderSymbolReExports();
        for (const { pattern, match } of providerSymbolReExports) {
          try {
            expect(match).toBeNull();
          } catch (error) {
            throw new Error(
              `core index.ts must not re-export provider symbol matching ${pattern}`,
              { cause: error },
            );
          }
        }
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * Core production source (non-test) must not import from
       * @vybestack/llxprt-code-providers. Verifies the forbidden scan from
       * anti-shim-policy.md.
       */
      function findCoreProductionProviderImports(): readonly string[] {
        const coreSrcDir = path.resolve(__dirname, '../../../core/src');
        const violations: string[] = [];
        const hasForbiddenProvidersImport = (content: string): boolean =>
          content.includes("from '@vybestack/llxprt-code-providers'") ||
          content.includes("from '@vybestack/llxprt-code-providers/") ||
          content.includes('from "@vybestack/llxprt-code-providers"') ||
          content.includes('from "@vybestack/llxprt-code-providers/');
        const isProductionTsFile = (name: string): boolean =>
          name.endsWith('.ts') &&
          !name.endsWith('.test.ts') &&
          !name.endsWith('.spec.ts');
        const isCommentLine = (line: string): boolean =>
          line.startsWith('//') ||
          line.startsWith('*') ||
          line.startsWith('/*');
        const collectFileViolations = (fullPath: string): void => {
          const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            const currentLine = lines[i] ?? '';
            if (isCommentLine(currentLine.trim())) {
              continue;
            }
            if (hasForbiddenProvidersImport(currentLine)) {
              const rel = path.relative(coreSrcDir, fullPath);
              violations.push(`${rel}:${i + 1}: ${currentLine.trim()}`);
            }
          }
        };
        function scanDir(dir: string) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanDir(fullPath);
            } else if (entry.isFile() && isProductionTsFile(entry.name)) {
              collectFileViolations(fullPath);
            }
          }
        }
        scanDir(coreSrcDir);

        return violations;
      }

      it('core production source has no imports from providers package', () => {
        const violations = findCoreProductionProviderImports();
        try {
          expect(violations).toHaveLength(0);
        } catch (error) {
          throw new Error(
            `Forbidden core production imports from providers:${String.fromCharCode(10)}${violations.join(String.fromCharCode(10))}`,
            { cause: error },
          );
        }
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * Core package.json must not depend on the providers package.
       */
      function readCoreProvidersDependency(): unknown {
        const corePkgPath = path.resolve(
          __dirname,
          '../../../core/package.json',
        );
        const pkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8'));
        const deps = pkg.dependencies ?? {};

        return deps['@vybestack/llxprt-code-providers'];
      }

      it('core package.json has no providers dependency', () => {
        const providersDependency = readCoreProvidersDependency();
        try {
          expect(providersDependency).toBeUndefined();
        } catch (error) {
          throw new Error(
            'core package.json must not depend on @vybestack/llxprt-code-providers',
            { cause: error },
          );
        }
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * No core/src/providers directory should exist after P11/P12 migration.
       */
      it('core/src/providers directory does not exist', () => {
        const coreProvidersDir = path.resolve(
          __dirname,
          '../../../core/src/providers',
        );
        const coreProvidersDirectoryExists = fs.existsSync(coreProvidersDir);
        try {
          expect(coreProvidersDirectoryExists).toBe(false);
        } catch (error) {
          throw new Error(
            'core/src/providers directory must not exist after migration',
            { cause: error },
          );
        }
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * No V2/Compat/New/Copy suffixed provider files in core.
       * Per anti-shim policy, these naming patterns indicate shims.
       */
      function findShimNamedProviderFilesInCore(): readonly string[] {
        const coreSrcDir = path.resolve(__dirname, '../../../core/src');
        const forbiddenSuffixes = ['V2', 'Compat', 'New', 'Copy'];
        const violations: string[] = [];
        const isShimNamedProviderFile = (name: string): boolean => {
          const basename = name
            .replace(/\.ts$/, '')
            .replace(/\.test$/, '')
            .replace(/\.spec$/, '');
          if (!/provider/i.test(basename)) {
            return false;
          }
          return forbiddenSuffixes.some((suffix) => basename.endsWith(suffix));
        };
        function scanForShimFiles(dir: string) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanForShimFiles(fullPath);
            } else if (
              entry.isFile() &&
              entry.name.endsWith('.ts') &&
              isShimNamedProviderFile(entry.name)
            ) {
              violations.push(path.relative(coreSrcDir, fullPath));
            }
          }
        }
        scanForShimFiles(coreSrcDir);

        return violations;
      }

      it('no V2/Compat/New/Copy suffixed provider files in core', () => {
        const violations = findShimNamedProviderFilesInCore();
        try {
          expect(violations).toHaveLength(0);
        } catch (error) {
          throw new Error(
            `Forbidden shim-named files in core: ${violations.join(', ')}`,
            { cause: error },
          );
        }
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * Core index.ts does not re-export from './providers/' path.
       * After P11/P12, the core/src/providers directory was removed,
       * so any remaining './providers/' re-export would be a broken
       * or shim reference.
       */
      function findCoreProvidersPathReExport(): RegExpMatchArray | null {
        const coreIndexPath = path.resolve(
          __dirname,
          '../../../core/src/index.ts',
        );
        const content = fs.readFileSync(coreIndexPath, 'utf-8');
        const codeLines = content
          .split('\n')
          .filter(
            (line) =>
              !line.trim().startsWith('//') && !line.trim().startsWith('*'),
          );
        const codeContent = codeLines.join('\n');

        return codeContent.match(/from\s+['"]\.\/providers\//);
      }

      it('core index.ts has no re-exports from ./providers/ path', () => {
        // Any export from ./providers/ would be a stale or shim re-export
        const providersPathReExport = findCoreProvidersPathReExport();
        try {
          expect(providersPathReExport).toBeNull();
        } catch (error) {
          throw new Error(
            'core index.ts must not re-export from ./providers/ path',
            { cause: error },
          );
        }
      });
    });
  });
});
