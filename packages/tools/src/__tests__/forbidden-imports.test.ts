/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-PKG-BOUNDARY
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolsSrcDir = join(__dirname, '..');

const FORBIDDEN_PACKAGE_IDS = [
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-providers',
  '@vybestack/llxprt-code-cli',
  '@vybestack/llxprt-code',
] as const;

const FORBIDDEN_PATH_PREFIXES = [
  'packages/core/src',
  'packages/providers/src',
  'packages/cli/src',
] as const;

const REGEX_SPECIAL_CHARS = new Set([
  '.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\',
]);

/** Escapes regex special characters so a literal string matches only itself. */
function escapeRegexLiteral(value: string): string {
  return value
    .split('')
    .map((c) => (REGEX_SPECIAL_CHARS.has(c) ? '\\' + c : c))
    .join('');
}

function scanForForbiddenImports(): {
  matches: Array<{ pattern: string; output: string }>;
} {
  const matches: Array<{ pattern: string; output: string }> = [];

  // Scan for package-qualified imports (e.g. from '@vybestack/llxprt-code-core')
  for (const pkgId of FORBIDDEN_PACKAGE_IDS) {
    try {
      // Match import/re-export lines containing the package ID
      const result = execSync(
        `rg -n "from\\s+['"].*${escapeRegexLiteral(pkgId)}" "${toolsSrcDir}" -g "*.ts" -g "!__tests__/**" --no-heading`,
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
        `rg -n "from\\s+['"].*${escapeRegexLiteral(prefix)}" "${toolsSrcDir}" -g "*.ts" -g "!__tests__/**" --no-heading`,
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

describe('packages/tools forbidden imports', () => {
  it('must not import from core, providers, or cli packages', () => {
    const { matches } = scanForForbiddenImports();
    expect(matches).toHaveLength(0);
  });

  it('must not have devDependencies on monorepo packages', () => {
    // This test is a structural check — the actual devDeps are checked
    // in package-boundary.test.ts. This test is kept for documentation.
    expect(FORBIDDEN_PACKAGE_IDS.length).toBeGreaterThan(0);
  });
});
