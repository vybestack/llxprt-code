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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANNED_AMBIENT_SYMBOLS,
  scanForBannedAmbientSymbols,
} from './ambient-runtime-symbols-guard.js';

it.each([
  'getActiveProfileName',
  'setDefaultProfileName',
  'getRuntimeDiagnosticsSnapshot',
])(
  'rejects deleted free profile accessor %s while allowing owner methods',
  (name) => {
    const root = mkdtempSync(join(tmpdir(), 'profile-accessor-guard-'));
    try {
      const file = join(root, 'consumer.ts');
      writeFileSync(
        file,
        `import { ${name} } from '@vybestack/llxprt-code-providers/runtime.js';\n`,
      );
      expect(scanForBannedAmbientSymbols([root]).violations).toHaveLength(1);
      writeFileSync(file, `export function ${name}() {}\n`);
      expect(scanForBannedAmbientSymbols([root]).violations).toHaveLength(1);
      writeFileSync(
        file,
        `class Owner { ${name}() {} }\nconst value = agent.${name}();\n`,
      );
      expect(scanForBannedAmbientSymbols([root]).violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

/**
 * Enumerates package and plugin src roots dynamically so the guard covers
 * production sources without a hardcoded project list.
 */
function repoProductionSrcRoots(): string[] {
  const repoRoot = resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    '..',
  );
  const roots: string[] = [];
  for (const directory of ['packages', 'plugins']) {
    const parent = join(repoRoot, directory);
    for (const entry of readdirSync(parent)) {
      const candidate = join(parent, entry, 'src');
      if (existsSync(candidate) && statSync(candidate).isDirectory())
        roots.push(candidate);
    }
  }
  return roots.sort();
}

it.each(['errors.ts', 'RetryOrchestrator.ts'])(
  'rejects ambient identity in migrated retry consumer %s',
  (name) => {
    const root = mkdtempSync(join(tmpdir(), 'retry-identity-guard-'));
    try {
      const file = join(root, name);
      writeFileSync(
        file,
        'import { getActiveRuntimeKind as kind } from "./runtime/active-runtime-identity.js";\n',
      );
      expect(scanForBannedAmbientSymbols([root]).violations).toHaveLength(1);
      writeFileSync(
        file,
        'export function suffix(runtimeKind: string | undefined) { return runtimeKind; }\n',
      );
      expect(scanForBannedAmbientSymbols([root]).violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
describe('ambient runtime symbols guard', () => {
  it.each([
    'ownershipByConfig',
    'oauthRuntimeBridge',
    'OAuthRuntimeBridge',
    'OAuthRuntimeAccessors',
    'buildOAuthRuntimeAccessors',
    'registerOAuthRuntimeAccessors',
    'getBrowserProfileAssociationStore',
  ])(
    'rejects the deleted OAuth bridge symbol %s without banning unrelated accessors',
    (symbol) => {
      const root = mkdtempSync(join(tmpdir(), 'oauth-bridge-guard-'));
      try {
        const file = join(root, 'consumer.ts');
        writeFileSync(file, `export const ${symbol} = {};\n`);
        expect(scanForBannedAmbientSymbols([root]).violations).toHaveLength(1);
        writeFileSync(
          file,
          'export function getEphemeralSetting() {}\nexport function getBrowserProfileAssociation() {}\nexport function getInteractiveAuthTimeoutMs() {}\n',
        );
        expect(scanForBannedAmbientSymbols([root]).violations).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    'runtimeRegistry',
    'setDefaultCliRuntimeId',
    'upsertRuntimeEntry',
    'registerCliProviderInfrastructure',
    'enterRuntimeScope',
    'runWithRuntimeScope',
    'getCurrentRuntimeScope',
  ])('rejects removed provider identity mechanism %s', (symbol) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'provider-identity-guard-'));
    try {
      writeFileSync(
        join(fixtureRoot, 'consumer.ts'),
        `export const ${symbol} = 1;\n`,
      );
      expect(
        scanForBannedAmbientSymbols([fixtureRoot]).violations,
      ).toHaveLength(1);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects module-owned OAuth registration state but allows instance fields and local names', () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), 'oauth-registration-guard-'),
    );
    try {
      const file = join(fixtureRoot, 'oauth-provider-registration.ts');
      writeFileSync(
        file,
        'let registeredProviders = new WeakMap<object, Set<string>>();\n',
      );
      const rejected = scanForBannedAmbientSymbols([fixtureRoot]);
      expect(rejected.violations).toEqual([
        {
          file,
          line: 1,
          text: 'let registeredProviders = new WeakMap<object, Set<string>>();',
        },
      ]);

      writeFileSync(
        file,
        [
          'class Manager { registeredProviders = new Map(); }',
          'function names(manager: Manager) { const registeredProviders = manager.registeredProviders; return registeredProviders; }',
          '// registeredProviders is an instance field, not a module registry.',
        ].join('\n'),
      );
      expect(scanForBannedAmbientSymbols([fixtureRoot]).violations).toEqual([]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

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

  it.each([...BANNED_AMBIENT_SYMBOLS])(
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

  it('scans spec files while excluding ordinary test files', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ambient-guard-fixture-'));
    try {
      const srcDir = join(fixtureRoot, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        join(srcDir, 'deletion-proof.test.ts'),
        'const proof = "activateSettingsRuntimeContext";\\n',
      );
      writeFileSync(
        join(srcDir, 'deletion-proof.spec.ts'),
        'const proof = "activateSettingsRuntimeContext";\\n',
      );

      const result = scanForBannedAmbientSymbols([srcDir]);

      expect(result.scannedFiles).toBe(1);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.file).toContain('deletion-proof.spec.ts');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects imports from retired ambient runtime modules without named symbols', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ambient-guard-import-'));
    try {
      const srcDir = join(fixtureRoot, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        join(srcDir, 'consumer.ts'),
        'import { unrelated } from "@vybestack/llxprt-code-providers/runtime/runtimeAccessors.js";\\nvoid unrelated;\\n',
      );

      const result = scanForBannedAmbientSymbols([srcDir]);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.text).toContain('runtimeAccessors');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('enumerates every package with a src directory (no hardcoded list)', () => {
    const roots = repoProductionSrcRoots();
    const packageNames = roots.map((root) => basename(dirname(root)));

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
    for (const required of ['google-gemini', 'google-mcp-auth']) {
      expect(packageNames).toContain(required);
    }
  });

  it('finds no banned ambient symbols in real production sources', () => {
    const result = scanForBannedAmbientSymbols(repoProductionSrcRoots());

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
  }, 15_000);

  it('runs the ambient-symbol guard in CI', () => {
    const manifest: { scripts: Record<string, string> } = JSON.parse(
      readFileSync(resolve('package.json'), 'utf8'),
    );
    const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
    expect(manifest.scripts['check:ambient-runtime-symbols']).toBe(
      'bun scripts/tests/ambient-runtime-symbols-guard.ts',
    );
    expect(workflow).toContain('npm run check:ambient-runtime-symbols');
  });

  it('keeps the banned list aligned with the deleted mechanisms', () => {
    expect(BANNED_AMBIENT_SYMBOLS).toContain('resetRegisteredProviders');
    expect(BANNED_AMBIENT_SYMBOLS).toContain('settingsServiceInstance');
    expect(BANNED_AMBIENT_SYMBOLS).toContain('setProviderRuntimeStateFactory');
    expect(BANNED_AMBIENT_SYMBOLS).toContain(
      'deactivateSettingsRuntimeContext',
    );
    // PR B: AgentRuntimeState module-level registries and subscribe entry.
    expect(BANNED_AMBIENT_SYMBOLS).toContain('runtimeStateRegistry');
    expect(BANNED_AMBIENT_SYMBOLS).toContain('subscriptionRegistry');
    expect(BANNED_AMBIENT_SYMBOLS).toContain('subscribeToAgentRuntimeState');
  });
});
