/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2417: Boundary guard tests ensuring the inverted core->tools
 * dependency does not regress.
 *
 * These tests read source files directly and assert on import patterns,
 * following the convention established in packages/tools/src/__tests__/forbidden-imports.test.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configTsPath = join(__dirname, '..', 'config.ts');
const providerRegistryPath = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'providers',
  'src',
  'auth',
  'provider-registry.ts',
);

describe('import boundary guards @issue:2417', () => {
  describe('config.ts', () => {
    const source = readFileSync(configTsPath, 'utf-8');

    it('does not have a value import from @vybestack/llxprt-code-tools', () => {
      // Match import statements that are NOT type-only and import from
      // @vybestack/llxprt-code-tools (but NOT deep paths like .../tools/activate-skill.js)
      const lines = source.split('\n');
      const valueImportLines = lines.filter(
        (line) =>
          line.includes("@vybestack/llxprt-code-tools'") &&
          line.trim().startsWith('import') &&
          !line.trim().startsWith('import type'),
      );

      expect(valueImportLines).toHaveLength(0);
    });

    it('does not reference ActivateSkillTool', () => {
      // The word ActivateSkillTool should not appear in any import or
      // constructor call — only in comments is acceptable.
      const codeLines = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'));

      const referencingLines = codeLines.filter((line) =>
        line.includes('ActivateSkillTool'),
      );

      expect(referencingLines).toHaveLength(0);
    });

    it('allows type-only imports from @vybestack/llxprt-code-tools', () => {
      // type-only imports are fine — they are elided at runtime.
      const lines = source.split('\n');
      const typeImportLines = lines.filter(
        (line) =>
          line.includes("@vybestack/llxprt-code-tools'") &&
          line.trim().startsWith('import type'),
      );

      // There should be at least one (ToolRegistry)
      expect(typeImportLines.length).toBeGreaterThan(0);
    });
  });

  describe('provider-registry.ts', () => {
    const source = readFileSync(providerRegistryPath, 'utf-8');

    it('imports DebugLogger from a deep path, not the core barrel', () => {
      // Must import from @vybestack/llxprt-code-core/debug/...
      const deepImportRegex =
        /from\s+['"]@vybestack\/llxprt-code-core\/debug\/DebugLogger\.js['"]/;

      expect(deepImportRegex.test(source)).toBe(true);
    });

    it('does not import from the core barrel', () => {
      // Must NOT import from bare @vybestack/llxprt-code-core'
      const barrelImportRegex = /from\s+['"]@vybestack\/llxprt-code-core['"]/;

      expect(barrelImportRegex.test(source)).toBe(false);
    });
  });
});
