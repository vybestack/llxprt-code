/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral manifest-violation and operational-failure tests for
 * scripts/check-genai-enclave.ts (#2352).
 *
 * Split from genai-enclave-guard.test.ts to keep each test file under the
 * lint max-lines limit. These tests exercise the guard's manifest checking
 * (package.json dependency declarations) and operational fail-closed
 * behavior.
 *
 * Tests invoke the real guard script via an async child process (no mock theater).
 *
 * Per RULES.md: positive tests ISOLATE the enclave under test; negative
 * tests verify the exact file that should be flagged.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  bunAvailable,
  runScript,
  withFixture,
  writeRequiredManifests,
} from './genai-enclave-guard-helpers.ts';

const missingBunMessage =
  '[genai-enclave] Bun runtime not found — install Bun or set BUN_EXECUTABLE.';

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-genai-enclave (manifest + operational)',
  () => {
    beforeAll(() => {
      if (process.env.CI === 'true' && !bunAvailable()) {
        throw new Error(`${missingBunMessage} Guard tests cannot run in CI.`);
      }
    });

    // ── Manifest violations ────────────────────────────────────────────
    // Each fixture includes a minimal scannable source file so the guard
    // reaches the manifest check and fails specifically on the manifest
    // violation (not on "no scannable files found").
    describe('manifest violations', () => {
      it('allows the root packaging bridge at the sanctioned version', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'package.json',
            JSON.stringify({
              name: 'test-root',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          // F4: all required (sanctioned) manifests must be present
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-core',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write(
            'packages/providers/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-providers',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('FAILS when packages/cli declares @google/genai', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-cli',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('packages/cli');
        expect(stdout).toContain('@google/genai');
      });

      it('FAILS when a nested package manifest declares @google/genai', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/examples/server/package.json',
            JSON.stringify({
              name: 'nested-server',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('packages/cli/examples/server');
        expect(stdout).toContain('@google/genai');
      });

      it('FAILS when packages/core declares wrong version of @google/genai', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          // Overwrite packages/core with the wrong version
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-core',
              dependencies: { '@google/genai': '1.29.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('does not match');
        expect(stdout).toContain('1.30.0');
      });

      it('FAILS when packages/cli declares @google/genai in optionalDependencies', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-cli',
              optionalDependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('optionalDependencies');
        expect(stdout).toContain('@google/genai');
      });

      it('FAILS when root package.json is malformed JSON (fail-closed)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          // Overwrite root with broken JSON
          write(
            'package.json',
            '{ "name": "broken", "dependencies": { "@google/genai": ',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
      });

      it('allows packages/core to declare @google/genai at 1.30.0', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'package.json',
            JSON.stringify({
              name: 'test-root',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-core',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write(
            'packages/providers/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-providers',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('allows packages/providers to declare @google/genai at 1.30.0', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'package.json',
            JSON.stringify({
              name: 'test-root',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-core',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write(
            'packages/providers/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-providers',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/providers/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('FAILS when a dependency section is an array instead of an object (fail-closed)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          // Overwrite root with array deps
          write(
            'package.json',
            JSON.stringify({
              name: 'bad-shape',
              dependencies: ['@google/genai'],
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
        expect(stdout).toContain('dependencies');
      });

      it('FAILS when a dependency section is a string instead of an object (fail-closed)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          // Overwrite core with string deps
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: 'bad-shape-pkg',
              dependencies: '@google/genai',
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
      });

      it('FAILS when a dependency section is null instead of an object (fail-closed)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/package.json',
            JSON.stringify({
              name: 'null-deps',
              dependencies: null,
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
      });

      it('FAILS when an npm alias targets @google/genai (F1)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/package.json',
            JSON.stringify({
              name: 'aliased-pkg',
              dependencies: {
                'fake-sdk': 'npm:@google/genai@1.30.0',
              },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('npm alias');
        expect(stdout).toContain('@google/genai');
      });

      it('FAILS when an npm alias targets a @google/genai subpath (F1)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/agents/package.json',
            JSON.stringify({
              name: 'subpath-aliased-pkg',
              dependencies: {
                sdk: 'npm:@google/genai/dist@1.30.0',
              },
            }) + '\n',
          );
          write('packages/agents/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('npm alias');
      });

      it('FAILS when SDK declared in both dependencies and devDependencies (F9)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          // Overwrite core with duplicate sections
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: 'dup-section-pkg',
              dependencies: { '@google/genai': '1.30.0' },
              devDependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('duplicate');
      });

      it('FAILS when SDK declared in both dependencies and peerDependencies (F9)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          // Overwrite providers with duplicate sections
          write(
            'packages/providers/package.json',
            JSON.stringify({
              name: 'dup-peer-pkg',
              dependencies: { '@google/genai': '1.30.0' },
              peerDependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/providers/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('duplicate');
      });

      it('FAILS when SDK declared in dependencies and optionalDependencies (F9)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          // Overwrite core with duplicate deps + optionalDependencies
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: 'dup-opt-pkg',
              dependencies: { '@google/genai': '1.30.0' },
              optionalDependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('duplicate');
        expect(stdout).toContain('optionalDependencies');
      });

      it('FAILS when a sanctioned workspace omits the SDK from dependencies (F10)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          // Overwrite core with a manifest that omits the SDK
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: 'missing-sdk-pkg',
              dependencies: { chalk: '^4.0.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('missing');
      });

      it('FAILS when a dependency value is not a string (F6 fail-closed)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/package.json',
            JSON.stringify({
              name: 'non-string-ver',
              dependencies: { '@google/genai': 1.3 },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
      });

      it('FAILS when a required root manifest is absent (F4 fail-closed)', async () => {
        // Root package.json is missing entirely — the packaging bridge
        // must be checked, so its absence is an operational failure.
        const { code, stdout } = await withFixture(({ root, write }) => {
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
        expect(stdout).toContain('package.json');
      });

      it('FAILS when packages/core manifest is absent (F4 fail-closed)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'package.json',
            JSON.stringify({
              name: 'test-root',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          // providers manifest is present so the failure isolates to core
          write(
            'packages/providers/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-providers',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
        expect(stdout).toContain('packages/core');
      });

      it('FAILS when packages/providers manifest is absent (F4 fail-closed)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'package.json',
            JSON.stringify({
              name: 'test-root',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-core',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          write('packages/providers/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
      });
    });

    // ── Operational failures (fail-closed) ─────────────────────────────
    describe('operational failures (fail-closed)', () => {
      it('FAILS when zero TypeScript files are found (temp root with no packages)', async () => {
        // No files written — packages/ dir does not exist
        const { code, stdout } = await withFixture(({ root }) =>
          runScript(root),
        );
        expect(code).toBe(1);
        expect(stdout).toContain('no scannable files found');
      });

      it('FAILS on source with parse diagnostics (invalid syntax)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/broken-syntax.ts',
            'export const x = ((((;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('broken-syntax.ts');
        expect(stdout).toContain('fail-closed');
      });
    });

    // ── Allowlist consistency ──────────────────────────────────────────
    describe('allowlist consistency', () => {
      it('GEMINI_NAME_EXPLICIT_ALLOWLIST has no duplicate path::name keys', async () => {
        const { GEMINI_NAME_EXPLICIT_ALLOWLIST } = await import(
          '../genai-enclave/config.ts'
        );
        const keys = GEMINI_NAME_EXPLICIT_ALLOWLIST.map(
          (e) => `${e.path}::${e.name}`,
        );
        const seen = new Set<string>();
        const dups = keys.filter((k) => {
          if (seen.has(k)) return true;
          seen.add(k);
          return false;
        });
        expect(dups, `Duplicate allowlist entries: ${dups.join(', ')}`).toEqual(
          [],
        );
      });

      it('every allowlist entry has path, name, and justification', async () => {
        const { GEMINI_NAME_EXPLICIT_ALLOWLIST } = await import(
          '../genai-enclave/config.ts'
        );
        for (const entry of GEMINI_NAME_EXPLICIT_ALLOWLIST) {
          expect(entry.path.length).toBeGreaterThan(0);
          expect(entry.name.length).toBeGreaterThan(0);
          expect(entry.justification.length).toBeGreaterThan(0);
        }
      });

      it('GENAI_DEPENDENCY_MANIFESTS includes the packaging bridge and implementation workspaces', async () => {
        const { GENAI_DEPENDENCY_MANIFESTS } = await import(
          '../genai-enclave/config.ts'
        );
        const dirs = GENAI_DEPENDENCY_MANIFESTS.map(
          (e) => e.workspaceDir,
        ).sort();
        expect(dirs).toEqual(['.', 'packages/core', 'packages/providers']);
        for (const entry of GENAI_DEPENDENCY_MANIFESTS) {
          expect(entry.version).toBe('1.30.0');
          expect(entry.justification.length).toBeGreaterThan(0);
        }
      });

      it('GENAI_IMPORT_ENCLAVES has exactly gemini and code_assist with justifications', async () => {
        const { GENAI_IMPORT_ENCLAVES } = await import(
          '../genai-enclave/config.ts'
        );
        const prefixes = GENAI_IMPORT_ENCLAVES.map((e) => e.prefix).sort();
        expect(prefixes).toEqual([
          'packages/core/src/code_assist/',
          'packages/providers/src/gemini/',
        ]);
        for (const entry of GENAI_IMPORT_ENCLAVES) {
          expect(entry.justification.length).toBeGreaterThan(0);
        }
      });

      it('every allowlist path::name refers to a real file in the repo (liveness)', async () => {
        const { GEMINI_NAME_EXPLICIT_ALLOWLIST } = await import(
          '../genai-enclave/config.ts'
        );
        const stale: string[] = [];
        for (const entry of GEMINI_NAME_EXPLICIT_ALLOWLIST) {
          const abs = join(REPO_ROOT, entry.path);
          if (!existsSync(abs)) {
            stale.push(`${entry.path}::${entry.name} (file not found)`);
          }
        }
        expect(
          stale,
          `Stale allowlist entries (file no longer exists): ${stale.join(', ')}`,
        ).toEqual([]);
      });
    });
  },
);
