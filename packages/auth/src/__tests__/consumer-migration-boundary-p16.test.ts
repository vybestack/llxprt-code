/**
 * @plan:PLAN-20260608-ISSUE1586.P16
 * @requirement:REQ-DEP-001.2
 * @requirement:REQ-AUTH-001.3
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P16: Consumer-migration package boundary tests.
 *
 * These tests enforce package boundary constraints from the consumer side:
 * - No auth→core forbidden imports in auth production code
 * - No relative import escapes from auth/src
 * - No old core/auth imports in any consumer package
 * - No old core/auth subpath exports in core package.json
 *
 * This complements the P04 package-boundary.test.ts by testing from
 * the consumer perspective (core, CLI, providers) rather than auth-internal.
 *
 * No mock theater. No reverse testing.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const THIS_DIR = __dirname;
const SRC_DIR = path.resolve(THIS_DIR, '..');
const AUTH_DIR = path.resolve(SRC_DIR, '..');
const PACKAGES_DIR = path.resolve(AUTH_DIR, '..');
const CORE_DIR = path.join(PACKAGES_DIR, 'core');
const CLI_DIR = path.join(PACKAGES_DIR, 'cli');
const PROVIDERS_DIR = path.join(PACKAGES_DIR, 'providers');

/** Canonical forbidden imports in auth production code. */
const FORBIDDEN_VYBESTACK_IMPORTS = [
  /from\s+['"]@vybestack\/llxprt-code-core['"]/u,
  /from\s+['"]@vybestack\/llxprt-code-core\//u,
  /from\s+['"]@vybestack\/llxprt-code-cli['"]/u,
  /from\s+['"]@vybestack\/llxprt-code-cli\//u,
  /from\s+['"]@vybestack\/llxprt-code-providers['"]/u,
  /from\s+['"]@vybestack\/llxprt-code-providers\//u,
  /from\s+['"]@vybestack\/llxprt-code-tools['"]/u,
  /from\s+['"]@vybestack\/llxprt-code['"]/u,
];

/** Old core/auth subpath imports forbidden everywhere. */
const FORBIDDEN_OLD_AUTH_IMPORTS = [
  /from\s+['"]@vybestack\/llxprt-code-core\/auth['"]/u,
  /from\s+['"]@vybestack\/llxprt-code-core\/auth\//u,
];

/** Relative path escapes forbidden in auth production. */
const FORBIDDEN_RELATIVE_ESCAPES = /\.\.\/\.\.\/\.\./u;

/**
 * Collect .ts files, optionally excluding tests.
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
 * Find lines matching a pattern, skipping comments.
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
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      continue;
    }
    if (pattern.test(lines[i])) {
      violations.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────
// Auth production: no forbidden imports
// ─────────────────────────────────────────────────────────────────

describe('P16: Auth production has no forbidden core/cli/providers imports', () => {
  it('auth production code has zero @vybestack/* forbidden imports', () => {
    const prodFiles = collectTsFiles(SRC_DIR, true).filter(
      (f) => !f.includes('__tests__'),
    );

    const violations: string[] = [];
    for (const filePath of prodFiles) {
      const relPath = path.relative(AUTH_DIR, filePath);
      for (const pattern of FORBIDDEN_VYBESTACK_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden imports in auth production:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('auth production code has no relative-path escapes', () => {
    const prodFiles = collectTsFiles(SRC_DIR, true).filter(
      (f) => !f.includes('__tests__'),
    );

    const violations: string[] = [];
    for (const filePath of prodFiles) {
      const relPath = path.relative(AUTH_DIR, filePath);
      violations.push(
        ...findViolatingLines(filePath, FORBIDDEN_RELATIVE_ESCAPES, relPath),
      );
    }

    expect(
      violations,
      `Forbidden relative-path escapes in auth production:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Auth test code: no forbidden imports
// ─────────────────────────────────────────────────────────────────

describe('P16: Auth tests have no forbidden core/providers imports', () => {
  it('auth test code has zero @vybestack/llxprt-code-core imports', () => {
    const testFiles = collectTsFiles(path.join(SRC_DIR, '__tests__'), false);

    const violations: string[] = [];
    for (const filePath of testFiles) {
      const relPath = path.relative(AUTH_DIR, filePath);
      const corePattern = /from\s+['"]@vybestack\/llxprt-code-core['"]/u;
      const coreSubPattern = /from\s+['"]@vybestack\/llxprt-code-core\//u;
      violations.push(...findViolatingLines(filePath, corePattern, relPath));
      violations.push(...findViolatingLines(filePath, coreSubPattern, relPath));
    }

    expect(
      violations,
      `Forbidden core imports in auth tests:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('auth test code has zero @vybestack/llxprt-code-providers imports', () => {
    const testFiles = collectTsFiles(path.join(SRC_DIR, '__tests__'), false);

    const violations: string[] = [];
    for (const filePath of testFiles) {
      const relPath = path.relative(AUTH_DIR, filePath);
      const providersPattern =
        /from\s+['"]@vybestack\/llxprt-code-providers['"]/u;
      const providersSubPattern =
        /from\s+['"]@vybestack\/llxprt-code-providers\//u;
      violations.push(
        ...findViolatingLines(filePath, providersPattern, relPath),
      );
      violations.push(
        ...findViolatingLines(filePath, providersSubPattern, relPath),
      );
    }

    expect(
      violations,
      `Forbidden providers imports in auth tests:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Consumer packages: no old core/auth imports
// ─────────────────────────────────────────────────────────────────

describe('P16: Consumer packages have no old core/auth imports', () => {
  it('core production source has zero imports from core/auth subpath', () => {
    const coreSrcDir = path.join(CORE_DIR, 'src');
    const coreFiles = collectTsFiles(coreSrcDir, true).filter(
      (f) => !f.includes('__tests__'),
    );

    const violations: string[] = [];
    for (const filePath of coreFiles) {
      const relPath = path.relative(CORE_DIR, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in core production:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('providers production source has zero imports from core/auth subpath', () => {
    const providersSrcDir = path.join(PROVIDERS_DIR, 'src');
    const providersFiles = collectTsFiles(providersSrcDir, true).filter(
      (f) => !f.includes('__tests__'),
    );

    const violations: string[] = [];
    for (const filePath of providersFiles) {
      const relPath = path.relative(PROVIDERS_DIR, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in providers production:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('CLI source has zero imports from core/auth subpath', () => {
    const cliSrcDir = path.join(CLI_DIR, 'src');
    const cliFiles = collectTsFiles(cliSrcDir, true);

    const violations: string[] = [];
    for (const filePath of cliFiles) {
      const relPath = path.relative(CLI_DIR, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in CLI source:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('CLI test files have zero imports from core/auth subpath', () => {
    const cliSrcDir = path.join(CLI_DIR, 'src');
    const cliTestFiles = collectTsFiles(cliSrcDir, false).filter(
      (f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'),
    );

    const violations: string[] = [];
    for (const filePath of cliTestFiles) {
      const relPath = path.relative(CLI_DIR, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in CLI tests:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Core package.json: no auth subpath exports
// ─────────────────────────────────────────────────────────────────

describe('P16: Core package.json has no auth subpath exports', () => {
  it('core package.json exports have no ./auth/ or ./auth entries', () => {
    const corePkgPath = path.join(CORE_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    const exports = (pkg.exports ?? {}) as Record<string, unknown>;
    const authSubpaths = Object.keys(exports).filter(
      (key) => key.startsWith('./auth/') || key === './auth',
    );
    expect(
      authSubpaths,
      `core package.json must not have auth subpath exports: ${authSubpaths.join(', ')}`,
    ).toStrictEqual([]);
  });
});
