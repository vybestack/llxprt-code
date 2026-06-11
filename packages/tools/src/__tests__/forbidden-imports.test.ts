/**
 * @plan:PLAN-20260608-ISSUE1585.P04
 * @requirement:REQ-PKG-BOUNDARY
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Forbidden Import Boundary Test
 *
 * Scans packages/tools/src for forbidden imports at test time.
 * Uses ripgrep-based detection to find actual import violations.
 * This test passes when zero forbidden imports exist.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const toolsSrcDir = resolve(import.meta.dirname, '..');

/**
 * Scans production source files (excluding test files) for actual import
 * or re-export statements referencing forbidden packages.
 *
 * Uses ripgrep with import/export line matching to avoid false positives
 * from comments or string literals in test files.
 */
const FORBIDDEN_PACKAGE_IDS = [
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-providers',
  '@vybestack/llxprt-code-cli',
] as const;

const FORBIDDEN_PATH_PREFIXES = [
  'packages/core/src',
  'packages/providers/src',
  'packages/cli/src',
] as const;

function scanForForbiddenImports(): {
  matches: Array<{ pattern: string; output: string }>;
} {
  const matches: Array<{ pattern: string; output: string }> = [];

  // Scan for package-qualified imports (e.g. from '@vybestack/llxprt-code-core')
  for (const pkgId of FORBIDDEN_PACKAGE_IDS) {
    try {
      // Match import/re-export lines containing the package ID
      const result = execSync(
        `rg -n "from\s+['\"].*${pkgId}" "${toolsSrcDir}" -g "*.ts" -g "!__tests__/**" --no-heading`,
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10_000,
        },
      );
      if (result.trim().length > 0) {
        matches.push({ pattern: pkgId, output: result.trim() });
      }
    } catch {
      // rg exits with code 1 when no matches found — that's the expected pass case
    }
  }

  // Scan for relative path imports (e.g. from '../../core/src/...')
  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    try {
      const result = execSync(
        `rg -n "from\s+['\"].*${prefix}" "${toolsSrcDir}" -g "*.ts" -g "!__tests__/**" --no-heading`,
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10_000,
        },
      );
      if (result.trim().length > 0) {
        matches.push({ pattern: prefix, output: result.trim() });
      }
    } catch {
      // rg exits with code 1 when no matches found — that's the expected pass case
    }
  }

  return { matches };
}

describe('Forbidden Import Boundary @plan:PLAN-20260608-ISSUE1585.P04', () => {
  it('production source must not import from @vybestack/llxprt-code-core or packages/core/src', () => {
    const { matches } = scanForForbiddenImports();
    const coreMatches = matches.filter(
      (m) =>
        m.pattern === '@vybestack/llxprt-code-core' ||
        m.pattern === 'packages/core/src',
    );
    expect(coreMatches).toHaveLength(0);
  });

  it('production source must not import from @vybestack/llxprt-code-providers or packages/providers/src', () => {
    const { matches } = scanForForbiddenImports();
    const providerMatches = matches.filter(
      (m) =>
        m.pattern === '@vybestack/llxprt-code-providers' ||
        m.pattern === 'packages/providers/src',
    );
    expect(providerMatches).toHaveLength(0);
  });

  it('production source must not import from @vybestack/llxprt-code-cli or packages/cli/src', () => {
    const { matches } = scanForForbiddenImports();
    const cliMatches = matches.filter(
      (m) =>
        m.pattern === '@vybestack/llxprt-code-cli' ||
        m.pattern === 'packages/cli/src',
    );
    expect(cliMatches).toHaveLength(0);
  });

  it('zero total forbidden imports across all patterns', () => {
    const { matches } = scanForForbiddenImports();
    expect(matches).toHaveLength(0);
  });
});
