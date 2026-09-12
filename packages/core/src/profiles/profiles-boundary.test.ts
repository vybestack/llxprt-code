/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profiles package boundary behavioral tests.
 *
 * These tests prove the profiles tree (contracts + ports) stays inside core: no import
 * reaches the settings or providers packages, no relative import escapes the profiles
 * directory, and the barrels do not leak implementation-owner symbols. The settings and
 * providers packages own the real config, secret, and catalog machinery; the profiles tree
 * names only structural mirrors and reference-only port shapes.
 *
 * The credential types (CredentialBinding, CredentialResolverPort, CredentialSecret) are
 * allowed in the barrels: they are references, not secrets. CredentialBinding holds key
 * names, paths, and bucket ids; the resolver produces a short-lived secret at use time.
 *
 * @plan:PLAN-20260808-ISSUE2643
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// This test file lives in packages/core/src/profiles/
// Resolve paths relative to this file's location
const THIS_DIR = __dirname; // packages/core/src/profiles
const PROFILES_DIR = THIS_DIR;
const CORE_SRC_DIR = path.join(THIS_DIR, '..'); // packages/core/src
const PACKAGES_CORE_DIR = path.join(CORE_SRC_DIR, '..'); // packages/core

const FORBIDDEN_IMPORT_PACKAGES = [
  '@vybestack/llxprt-code-settings',
  '@vybestack/llxprt-code-providers',
];

const FORBIDDEN_SUBSTRINGS = [
  'Config',
  'SettingsService',
  'ProviderManager',
  'RuntimeServices',
  'ServiceBag',
  'registryId',
];

/**
 * Identifier that legitimately contains a forbidden substring and is exempt from the
 * barrel scan: `ProfileAuthConfig` is a structural contract union ({ type: 'oauth'
 * } | { type: 'apikey' }) — its name embeds `Config` but it is the
 * implementation-neutral mirror, not the settings-owned Config symbol. The other five
 * forbidden substrings must never appear.
 */
const ALLOWED_SUBSTRING_CONTAINERS = ['ProfileAuthConfig'];

/**
 * Return the first forbidden substring present in the content after exempted containers are
 * removed, or null when none remain.
 */
function findForbiddenSubstring(content: string): string | null {
  let remaining = content;
  for (const allowed of ALLOWED_SUBSTRING_CONTAINERS) {
    remaining = remaining.split(allowed).join('');
  }
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (remaining.includes(forbidden)) {
      return forbidden;
    }
  }
  return null;
}

/**
 * Recursively collect every .ts file under a directory, depth-first.
 */
function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts')) {
      result.push(fullPath);
    }
  }
  return result;
}

/**
 * Collect the import specifiers from a TypeScript source file.
 *
 * Handles single- and multi-line import/export-from statements across the whole source.
 * Only the specifier string matters for the escape checks; the imported
 * names are irrelevant to a package/directory boundary.
 */
function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const statements = /\b(?:from|import)\s+['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(statements)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * Normalize a relative specifier against its file's directory and answer whether the
 * resolved target stays inside the profiles tree.
 */
function resolvesWithinProfiles(specifier: string, fileDir: string): boolean {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const absolute = path.resolve(fileDir, specifier);
    const relative = path.relative(PROFILES_DIR, absolute);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }
  return false;
}

/**
 * Answer whether a specifier resolves to an absolute path outside the profiles tree
 * (an import escape) versus a package or node: module.
 */
function isEscapingRelative(specifier: string, fileDir: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return false;
  }
  return !resolvesWithinProfiles(specifier, fileDir);
}

function isNodeSpecifier(specifier: string): boolean {
  return specifier.startsWith('node:');
}

describe('Import boundary scanner', () => {
  for (const forbidden of FORBIDDEN_IMPORT_PACKAGES) {
    it(`flags multiline imports from ${forbidden}`, () => {
      const source = `import {
  ForbiddenSymbol,
  AnotherSymbol,
} from '${forbidden}';`;
      const violations = extractImportSpecifiers(source).filter((specifier) =>
        FORBIDDEN_IMPORT_PACKAGES.includes(specifier),
      );
      expect(violations).toStrictEqual([forbidden]);
    });
  }

  it('extracts multiline re-exports and side-effect imports', () => {
    expect(
      extractImportSpecifiers(`export type {
  Thing,
} from '../outside.js';
import './local.js';`),
    ).toStrictEqual(['../outside.js', './local.js']);
  });
});

describe('Profiles tree must not import settings or providers packages', () => {
  const profileFiles = collectTsFiles(PROFILES_DIR).filter(
    (filePath) => !filePath.endsWith('.test.ts'),
  );

  it('has non-test files to scan', () => {
    expect(profileFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of profileFiles) {
    const relativePath = path.relative(CORE_SRC_DIR, filePath);
    it(`${relativePath}: no settings/provider package imports`, () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const specifier of extractImportSpecifiers(content)) {
        for (const forbidden of FORBIDDEN_IMPORT_PACKAGES) {
          expect(specifier).not.toContain(forbidden);
        }
      }
    });

    it(`${relativePath}: no relative import escapes the profiles tree`, () => {
      const fileDir = path.dirname(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const specifier of extractImportSpecifiers(content)) {
        expect(isEscapingRelative(specifier, fileDir)).toBe(false);
      }
    });
  }
});

describe('Profiles tree imports stay within profiles or node:', () => {
  const profileFiles = collectTsFiles(PROFILES_DIR).filter(
    (filePath) => !filePath.endsWith('.test.ts'),
  );

  for (const filePath of profileFiles) {
    const relativePath = path.relative(CORE_SRC_DIR, filePath);
    it(`${relativePath}: every import stays inside profiles or is node:`, () => {
      const fileDir = path.dirname(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const specifier of extractImportSpecifiers(content)) {
        const ok =
          isNodeSpecifier(specifier) ||
          resolvesWithinProfiles(specifier, fileDir);
        expect(ok).toBe(true);
      }
    });
  }
});

describe('Profiles barrels do not leak implementation-owner symbols', () => {
  const barrelPaths = [
    path.join(PROFILES_DIR, 'index.ts'),
    path.join(PROFILES_DIR, 'contracts', 'index.ts'),
    path.join(PROFILES_DIR, 'ports', 'index.ts'),
  ];

  it('reads the three barrels', () => {
    for (const barrelPath of barrelPaths) {
      expect(fs.existsSync(barrelPath)).toBe(true);
    }
  });

  for (const barrelPath of barrelPaths) {
    const relativePath = path.relative(PROFILES_DIR, barrelPath);
    it(`${relativePath}: no forbidden implementation symbols`, () => {
      const content = fs.readFileSync(barrelPath, 'utf-8');
      const forbidden = findForbiddenSubstring(content);
      expect(forbidden).toBeNull();
    });
  }
});

describe('Core package manifest has no providers dependency', () => {
  it('core package.json dependency list excludes providers', () => {
    const corePackageJsonPath = path.join(PACKAGES_CORE_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(corePackageJsonPath, 'utf-8')) as {
      dependencies: Record<string, string>;
    };
    expect(
      pkg.dependencies['@vybestack/llxprt-code-providers'],
    ).toBeUndefined();
  });
});
