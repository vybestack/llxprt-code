/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the issue #2616 PR A banned-symbol guard.
 *
 * The control proves the checker can fail: it is run against a synthetic
 * fixture tree containing a deleted-symbol reference and must report the
 * violation. The repo run asserts the real production sources under every
 * packages package src directory contain none of the ambient mechanisms
 * this PR deleted.
 */

import { describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANNED_AMBIENT_SYMBOLS,
  scanForBannedAmbientSymbols,
} from './ambient-runtime-symbols-guard.js';

/**
 * Enumerates every packages/<pkg>/src source root dynamically so the guard
 * covers the whole monorepo; a package lacking a src/ directory makes
 * statSync throw (fail loud), it is not skipped.
 */
function repoPackageSrcRoots(): string[] {
  const repoRoot = resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    '..',
  );
  const packagesDir = join(repoRoot, 'packages');
  const roots: string[] = [];
  for (const entry of readdirSync(packagesDir)) {
    const candidate = join(packagesDir, entry, 'src');
    if (statSync(candidate).isDirectory()) {
      roots.push(candidate);
    }
  }
  return roots.sort();
}

describe('ambient runtime symbols guard', () => {
  it('reports a violation for a file referencing a deleted symbol', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ambient-guard-fixture-'));
    try {
      const srcDir = join(fixtureRoot, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        join(srcDir, 'ambient-user.ts'),
        [
          'import { peekActiveProviderRuntimeContext } from "./providerRuntimeContext.js";',
          'export function readRuntime() {',
          '  return peekActiveProviderRuntimeContext();',
          '}',
          '',
        ].join('\n'),
      );
      writeFileSync(join(srcDir, 'clean.ts'), 'export const clean = true;\n');

      const result = scanForBannedAmbientSymbols([srcDir]);

      expect(result.scannedFiles).toBe(2);
      expect(result.violations.length).toBe(2);
      expect(result.violations[0].line).toBe(1);
      expect(result.violations[1].line).toBe(3);
      expect(result.violations[0].text).toContain(
        'peekActiveProviderRuntimeContext',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each(BANNED_AMBIENT_SYMBOLS)(
    'reports a violation for every banned symbol (%s) on its own fixture',
    (bannedSymbol) => {
      const fixtureRoot = mkdtempSync(
        join(tmpdir(), 'ambient-guard-symbol-fixture-'),
      );
      try {
        const srcDir = join(fixtureRoot, 'src');
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(
          join(srcDir, 'ambient-user.ts'),
          [
            `import { ${bannedSymbol} } from "./ambient.js";`,
            `export function use() {`,
            `  return ${bannedSymbol};`,
            `}`,
            '',
          ].join('\n'),
        );

        const result = scanForBannedAmbientSymbols([srcDir]);

        expect(result.scannedFiles).toBe(1);
        expect(result.violations.length).toBe(2);
        expect(result.violations[0].line).toBe(1);
        expect(result.violations[1].line).toBe(3);
        for (const violation of result.violations) {
          expect(violation.text).toContain(bannedSymbol);
        }
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
  );

  it('ignores test and spec files even when they mention deleted symbols', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ambient-guard-fixture-'));
    try {
      const srcDir = join(fixtureRoot, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        join(srcDir, 'deletion-proof.test.ts'),
        'const proof = "activateSettingsRuntimeContext";\n',
      );

      const result = scanForBannedAmbientSymbols([srcDir]);

      // Test files are not scanned at all, so nothing counts as scanned and
      // no violation is reported for the deleted-symbol mention.
      expect(result.scannedFiles).toBe(0);
      expect(result.violations).toEqual([]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('enumerates every package with a src directory (no hardcoded list)', () => {
    const roots = repoPackageSrcRoots();
    const packageNames = roots.map((root) => root.split('/').at(-2));

    // Packages the pre-dynamic list missed must be covered.
    for (const required of [
      'zed-acp',
      'lsp',
      'storage',
      'telemetry',
      'policy',
      'ide-integration',
      'test-utils',
    ]) {
      expect(packageNames).toContain(required);
    }
    // Long-standing packages stay covered too.
    for (const required of ['core', 'cli', 'providers', 'settings', 'auth']) {
      expect(packageNames).toContain(required);
    }
  });

  it('finds no banned ambient symbols in real production sources', () => {
    const result = scanForBannedAmbientSymbols(repoPackageSrcRoots());

    expect(result.scannedFiles).toBeGreaterThan(100);
    expect(
      result.violations,
      `deleted ambient symbols found:\n${result.violations
        .map(
          (violation) =>
            `${violation.file}:${violation.line}: ${violation.text}`,
        )
        .join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the banned list aligned with the deleted mechanisms', () => {
    expect(BANNED_AMBIENT_SYMBOLS).toContain('settingsServiceInstance');
    expect(BANNED_AMBIENT_SYMBOLS).toContain('setProviderRuntimeStateFactory');
    expect(BANNED_AMBIENT_SYMBOLS).toContain(
      'deactivateSettingsRuntimeContext',
    );
  });
});
