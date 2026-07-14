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
 * Package Boundary Tests
 *
 * Verifies that packages/tools/package.json is correctly configured:
 * - No runtime dependencies on core, cli, or providers
 * - Correct package name, type, main, types, exports fields
 * - Package is self-contained as a leaf dependency
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const toolsRoot = resolve(import.meta.dirname, '../..');
const packageJsonPath = resolve(toolsRoot, 'package.json');

function loadPackageJson(): Record<string, unknown> {
  const raw = readFileSync(packageJsonPath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

const FORBIDDEN_RUNTIME_DEPS = [
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-cli',
  '@vybestack/llxprt-code-providers',
] as const;

describe('Package Boundary Tests @plan:PLAN-20260608-ISSUE1585.P04', () => {
  describe('package.json identity', () => {
    it('has correct scoped package name', () => {
      const pkg = loadPackageJson();
      expect(pkg.name).toBe('@vybestack/llxprt-code-tools');
    });

    it('has type module', () => {
      const pkg = loadPackageJson();
      expect(pkg.type).toBe('module');
    });

    it('has main entry pointing to dist/index.js', () => {
      const pkg = loadPackageJson();
      expect(pkg.main).toBe('dist/index.js');
    });

    it('has types entry pointing to dist/index.d.ts', () => {
      const pkg = loadPackageJson();
      expect(pkg.types).toBe('dist/index.d.ts');
    });

    it('has exports map with types and import conditions', () => {
      const pkg = loadPackageJson();
      const exports = pkg.exports as Record<string, unknown>;
      expect(exports).toBeDefined();
      const dotExport = exports['.'] as Record<string, unknown>;
      expect(dotExport).toBeDefined();
      expect(dotExport.types).toBe('./dist/index.d.ts');
      expect(dotExport.import).toBe('./dist/index.js');
    });
  });

  describe('dependency isolation', () => {
    it('must not depend on @vybestack/llxprt-code-core', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies as Record<string, unknown>);
      expect(deps).not.toContain('@vybestack/llxprt-code-core');
    });

    it('must not depend on @vybestack/llxprt-code-providers', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies as Record<string, unknown>);
      expect(deps).not.toContain('@vybestack/llxprt-code-providers');
    });

    it('must not depend on @vybestack/llxprt-code-cli', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies as Record<string, unknown>);
      expect(deps).not.toContain('@vybestack/llxprt-code-cli');
    });

    it('dependencies contains only external packages, no monorepo deps', () => {
      const pkg = loadPackageJson();
      const deps = pkg.dependencies as Record<string, unknown>;
      expect(deps).toBeDefined();
      const depKeys = Object.keys(deps);
      const forbidden = [
        '@vybestack/llxprt-code-core',
        '@vybestack/llxprt-code-providers',
        '@vybestack/llxprt-code-cli',
        '@vybestack/llxprt-code',
      ];
      for (const f of forbidden) {
        expect(depKeys).not.toContain(f);
      }
    });

    it('all forbidden packages absent from both dependencies and devDependencies', () => {
      const pkg = loadPackageJson();
      const allDeps = [
        ...Object.keys(pkg.dependencies as Record<string, unknown>),
        ...Object.keys(pkg.devDependencies as Record<string, unknown>),
      ];
      for (const forbidden of FORBIDDEN_RUNTIME_DEPS) {
        expect(allDeps).not.toContain(forbidden);
      }
    });
  });

  describe('package.json structural completeness', () => {
    it('has a version field', () => {
      const pkg = loadPackageJson();
      expect(typeof pkg.version).toBe('string');
      expect((pkg.version as string).length).toBeGreaterThan(0);
    });

    it('has a license field', () => {
      const pkg = loadPackageJson();
      expect(pkg.license).toBe('Apache-2.0');
    });

    it('has files array containing dist', () => {
      const pkg = loadPackageJson();
      const files = pkg.files as string[];
      expect(files).toBeDefined();
      expect(files).toContain('dist');
    });

    it('has required scripts (build, test, typecheck)', () => {
      const pkg = loadPackageJson();
      const scripts = pkg.scripts as Record<string, unknown>;
      expect(scripts.build).toBeDefined();
      expect(scripts.test).toBeDefined();
      expect(scripts.typecheck).toBeDefined();
    });

    it('has vitest in devDependencies', () => {
      const pkg = loadPackageJson();
      const devDeps = pkg.devDependencies as Record<string, unknown>;
      expect(devDeps.vitest).toBeDefined();
    });
  });

  describe('anti-cycle verifier: forbidden monorepo packages must not appear in tools dependencies', () => {
    it('no forbidden monorepo package in dependencies or devDependencies', () => {
      const pkg = loadPackageJson();
      const allDepEntries = {
        ...((pkg.dependencies ?? {}) as Record<string, unknown>),
        ...((pkg.devDependencies ?? {}) as Record<string, unknown>),
      };
      for (const forbidden of FORBIDDEN_RUNTIME_DEPS) {
        expect(allDepEntries).not.toHaveProperty(forbidden);
      }
      expect(allDepEntries).not.toHaveProperty('@vybestack/llxprt-code');
    });
  });

  describe('npm/package-lock process guards', () => {
    it('package-lock.json exists', () => {
      const lockPath = resolve(toolsRoot, '../../package-lock.json');
      expect(existsSync(lockPath)).toBe(true);
    });

    it('packages/tools entry exists in package-lock.json', () => {
      const lockPath = resolve(toolsRoot, '../../package-lock.json');
      const raw = readFileSync(lockPath, 'utf-8');
      const lock = JSON.parse(raw);
      expect(lock.packages).toHaveProperty('packages/tools');
    });

    it('packages/tools is in root workspaces', () => {
      const rootPkgPath = resolve(toolsRoot, '../../package.json');
      const raw = readFileSync(rootPkgPath, 'utf-8');
      const rootPkg = JSON.parse(raw);
      expect(rootPkg.workspaces).toContain('packages/tools');
    });
  });

  describe('tsconfig path-mapping boundary rule', () => {
    it('tsconfig has no forbidden path mappings to core, providers, or cli', () => {
      const tsconfigPath = resolve(toolsRoot, 'tsconfig.json');
      const raw = readFileSync(tsconfigPath, 'utf-8');
      const tsconfig = JSON.parse(raw);
      const paths = Object.keys(tsconfig.compilerOptions?.paths ?? {});
      const refs = (tsconfig.references ?? []).map(
        (r: { path: string }) => r.path,
      );
      const all = [...paths, ...refs];
      const forbidden = all.filter(
        (p: string) =>
          p.includes('../core') ||
          p.includes('../providers') ||
          p.includes('../cli'),
      );
      expect(forbidden).toHaveLength(0);
    });
  });

  describe('zod-to-json-schema dependency declaration', () => {
    it('has zod-to-json-schema in dependencies', () => {
      const pkg = loadPackageJson();
      const deps = pkg.dependencies as Record<string, unknown>;
      expect(deps).toBeDefined();
      expect(deps['zod-to-json-schema']).toBeDefined();
    });
  });
});
