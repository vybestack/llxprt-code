/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Allowlist-consistency tests for the genai-enclave guard (#2352).
 *
 * These tests verify that the configuration allowlists are internally
 * consistent and that every allowlisted path::name pair refers to a real
 * export in the actual source (AST liveness) and that config manifest
 * versions match the real workspace manifests (version cross-check).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, bunAvailable } from './genai-enclave-guard-helpers.ts';

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-genai-enclave — allowlist consistency',
  () => {
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
      const dirs = GENAI_DEPENDENCY_MANIFESTS.map((e) => e.workspaceDir).sort();
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

    it('every allowlist path::name refers to a real file that actually exports the name (AST liveness)', async () => {
      const { GEMINI_NAME_EXPLICIT_ALLOWLIST } = await import(
        '../genai-enclave/config.ts'
      );
      const { scanGeminiExports, parseSourceFile } = await import(
        '../genai-enclave/scanner.ts'
      );
      const stale: string[] = [];
      const exportCache = new Map<string, Set<string>>();
      for (const entry of GEMINI_NAME_EXPLICIT_ALLOWLIST) {
        const abs = join(REPO_ROOT, entry.path);
        if (!existsSync(abs)) {
          stale.push(`${entry.path}::${entry.name} (file not found)`);
          continue;
        }
        let exportedNames = exportCache.get(entry.path);
        if (exportedNames === undefined) {
          const content = readFileSync(abs, 'utf8');
          const sf = parseSourceFile(abs, content);
          exportedNames = new Set(
            scanGeminiExports(sf, entry.path).map((item) => item.exportName),
          );
          exportCache.set(entry.path, exportedNames);
        }
        if (!exportedNames.has(entry.name)) {
          stale.push(`${entry.path}::${entry.name} (export not found in file)`);
        }
      }
      expect(stale, `Stale allowlist entries: ${stale.join(', ')}`).toEqual([]);
    });

    it('GENAI_DEPENDENCY_MANIFESTS versions match the actual workspace manifests (cross-check)', async () => {
      const { GENAI_DEPENDENCY_MANIFESTS, GENAI_PACKAGE } = await import(
        '../genai-enclave/config.ts'
      );
      const depTypes = [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ] as const;
      const drift: string[] = [];
      for (const entry of GENAI_DEPENDENCY_MANIFESTS) {
        const manifestPath = join(
          REPO_ROOT,
          entry.workspaceDir,
          'package.json',
        );
        if (!existsSync(manifestPath)) continue;
        const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
          string,
          Record<string, string> | undefined
        >;
        const actualVersion = depTypes
          .map((dt) => pkg[dt]?.[GENAI_PACKAGE])
          .find((v) => v !== undefined);
        if (actualVersion !== undefined && actualVersion !== entry.version) {
          drift.push(
            `${entry.workspaceDir}: manifest has "${actualVersion}" but config has "${entry.version}"`,
          );
        }
      }
      expect(
        drift,
        `Config/manifest version drift: ${drift.join(', ')}`,
      ).toEqual([]);
    });
  },
);
