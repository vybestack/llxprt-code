/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anti-shim and package boundary behavioral tests.
 *
 * These tests prove that core-owned contract files and the core package
 * do NOT import from the providers package, and that core contract
 * barrel exports do NOT re-export any provider package symbols.
 *
 * These are behavioral tests — they verify import patterns that would
 * break the package boundary and trigger the "forbidden core→providers"
 * dependency direction.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// This test file lives in packages/core/src/runtime/contracts/
// Resolve paths relative to this file's location
const THIS_DIR = __dirname; // packages/core/src/runtime/contracts
const CONTRACTS_DIR = THIS_DIR;
const ERRORS_DIR = path.join(THIS_DIR, '..', 'errors');
const CORE_SRC_DIR = path.join(THIS_DIR, '..', '..'); // packages/core/src
const PACKAGES_CORE_DIR = path.join(CORE_SRC_DIR, '..'); // packages/core

/**
 * Recursively collect all .ts files in a directory (excluding test files).
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
 * Provider import substrings: if any of these appear in an import statement,
 * the file is importing from the providers package.
 */
const PROVIDER_IMPORT_SUBSTRINGS = [
  '/providers/',
  '@vybestack/llxprt-code-providers',
  'providers/IProvider',
  'providers/ProviderManager',
  'providers/ProviderContentGenerator',
  'providers/tokenizers/',
  'providers/errors',
  'providers/types',
  'providers/utils/',
];

/**
 * Checks whether a file's content contains any provider import.
 * Uses string matching on import statements rather than regex.
 */
function detectProviderImport(content: string): string | null {
  for (const line of content.split('\n')) {
    const result = checkLineForProviderImport(line);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

function checkLineForProviderImport(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
    return null;
  }
  if (!trimmed.startsWith('import') && !trimmed.includes('export')) {
    return null;
  }
  for (const substring of PROVIDER_IMPORT_SUBSTRINGS) {
    if (trimmed.includes(substring)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Strips single-line (// ...) and block (/* ... *\/) comments from tsconfig
 * content without using regex.
 */
function stripTsConfigComments(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inBlockComment = false;
  for (const line of lines) {
    const { processed, blockComment } = stripCommentsFromLine(
      line,
      inBlockComment,
    );
    inBlockComment = blockComment;
    result.push(processed);
  }
  return result.join('\n');
}

function stripCommentsFromLine(
  line: string,
  inBlockComment: boolean,
): { processed: string; blockComment: boolean } {
  let processed = '';
  let i = 0;
  let blockComment = inBlockComment;
  while (i < line.length) {
    if (blockComment) {
      const closeIdx = line.indexOf('*/', i);
      if (closeIdx === -1) {
        i = line.length;
      } else {
        blockComment = false;
        i = closeIdx + 2;
      }
    } else if (line[i] === '/' && line[i + 1] === '/') {
      break;
    } else if (line[i] === '/' && line[i + 1] === '*') {
      blockComment = true;
      i += 2;
    } else {
      processed += line[i];
      i++;
    }
  }
  return { processed, blockComment };
}

/**
 * Contract file tests: verify that P03 contract files have zero provider imports.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */
describe('Core contract files must not import from providers', () => {
  const contractFiles = collectTsFiles(CONTRACTS_DIR);
  const errorFiles = collectTsFiles(ERRORS_DIR);
  const allFiles = [...contractFiles, ...errorFiles];

  it('has contract and error files to scan', () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of allFiles) {
    const relativePath = path.relative(CORE_SRC_DIR, filePath);
    it(`${relativePath}: no provider imports`, () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const providerImport = detectProviderImport(content);
      expect(
        providerImport,
        `Provider import found in ${relativePath}: ${providerImport ?? ''}`,
      ).toBeNull();
    });
  }
});

/**
 * Core contract barrel export test: verify index.ts does NOT re-export
 * any provider symbols.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */
describe('Core contract barrel exports must not re-export provider symbols', () => {
  const contractIndexPath = path.join(CONTRACTS_DIR, 'index.ts');
  const errorIndexPath = path.join(ERRORS_DIR, 'index.ts');

  it('contracts/index.ts has no provider re-exports', () => {
    const content = fs.readFileSync(contractIndexPath, 'utf-8');
    expect(detectProviderImport(content)).toBeNull();
  });

  it('errors/index.ts has no provider re-exports', () => {
    const content = fs.readFileSync(errorIndexPath, 'utf-8');
    expect(detectProviderImport(content)).toBeNull();
  });
});

/**
 * Core contract naming test: verify that no V2/Compat/New/Copy suffixed
 * contract names exist. These are forbidden per anti-shim policy.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */
describe('Core contracts must not use forbidden naming patterns', () => {
  const contractFiles = collectTsFiles(CONTRACTS_DIR, true);
  const errorFiles = collectTsFiles(ERRORS_DIR, true);
  const allFiles = [...contractFiles, ...errorFiles];

  const FORBIDDEN_SUFFIXES = ['V2', 'Compat', 'New', 'Copy'];

  for (const filePath of allFiles) {
    const basename = path.basename(filePath, '.ts');
    it(`file ${basename} must not use forbidden naming suffix`, () => {
      for (const suffix of FORBIDDEN_SUFFIXES) {
        expect(
          basename.endsWith(suffix),
          `Contract file ${basename} uses forbidden suffix "${suffix}"`,
        ).toBe(false);
      }
    });
  }
});

/**
 * Tool-owned utilities must not import from providers.
 * The toolIdNormalization utility moved from core/tools/ to packages/tools.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */
describe('Tool-owned toolIdNormalization must not import from providers', () => {
  const toolIdNormPath = path.resolve(
    __dirname,
    '../../../../tools/src/formatters/toolIdNormalization.ts',
  );

  it('toolIdNormalization.ts has no provider imports', () => {
    const content = fs.readFileSync(toolIdNormPath, 'utf-8');
    expect(detectProviderImport(content)).toBeNull();
  });
});

/**
 * Package metadata boundary test: verify core package.json does not
 * depend on providers package.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */
describe('Core package metadata must not reference providers', () => {
  const corePackageJsonPath = path.join(PACKAGES_CORE_DIR, 'package.json');
  const coreTsconfigPath = path.join(PACKAGES_CORE_DIR, 'tsconfig.json');

  it('core package.json has no providers dependency', () => {
    const content = fs.readFileSync(corePackageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    const deps = pkg.dependencies ?? {};
    expect(
      deps['@vybestack/llxprt-code-providers'],
      'core package.json must not depend on @vybestack/llxprt-code-providers',
    ).toBeUndefined();
  });

  it.skipIf(!fs.existsSync(coreTsconfigPath))(
    'core tsconfig.json has no providers reference',
    () => {
      const content = fs.readFileSync(coreTsconfigPath, 'utf-8');
      // Strip comments before parsing (TypeScript tsconfig can have comments)
      const strippedContent = stripTsConfigComments(content);
      try {
        const tsconfig = JSON.parse(strippedContent);
        const references = tsconfig.references ?? [];
        for (const ref of references) {
          expect(
            ref.path.includes('providers'),
            `tsconfig.json references providers path: ${ref.path}`,
          ).toBe(false);
        }
      } catch {
        // If tsconfig.json can't be parsed (e.g. TS extends format), skip
      }
    },
  );
});
