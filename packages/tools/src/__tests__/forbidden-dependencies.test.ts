/**
 * @plan:PLAN-20260608-ISSUE1585.P07
 * @requirement:REQ-PKG-BOUNDARY
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Forbidden Dependencies Test
 *
 * Verifies that packages/tools does not depend on core, providers, or cli
 * in either dependencies or devDependencies (test-utils is acceptable).
 * This is a structural boundary enforcement test that complements the
 * runtime import boundary tests in forbidden-imports.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const toolsRoot = resolve(import.meta.dirname, '../..');
const packageJsonPath = resolve(toolsRoot, 'package.json');

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function loadPackageJson(): PackageJson {
  const raw = readFileSync(packageJsonPath, 'utf-8');
  return JSON.parse(raw);
}

const FORBIDDEN_IN_ALL = [
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-providers',
  '@vybestack/llxprt-code-cli',
  '@vybestack/llxprt-code',
] as const;

function collectAllDepNames(pkg: PackageJson): string[] {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ];
}

describe('Forbidden Dependencies Test @plan:PLAN-20260608-ISSUE1585.P07', () => {
  describe('dependencies must not include core, providers, or cli', () => {
    it('has no @vybestack/llxprt-code-core in dependencies', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies ?? {});
      expect(deps).not.toContain('@vybestack/llxprt-code-core');
    });

    it('has no @vybestack/llxprt-code-providers in dependencies', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies ?? {});
      expect(deps).not.toContain('@vybestack/llxprt-code-providers');
    });

    it('has no @vybestack/llxprt-code (cli) in dependencies', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies ?? {});
      expect(deps).not.toContain('@vybestack/llxprt-code');
    });

    it('dependencies contains only external packages (no monorepo deps)', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies ?? {});
      for (const forbidden of FORBIDDEN_IN_ALL) {
        expect(deps).not.toContain(forbidden);
      }
    });
  });

  describe('devDependencies must not include core or providers', () => {
    it('has no @vybestack/llxprt-code-core in devDependencies', () => {
      const pkg = loadPackageJson();
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      expect(devDeps).not.toContain('@vybestack/llxprt-code-core');
    });

    it('has no @vybestack/llxprt-code-providers in devDependencies', () => {
      const pkg = loadPackageJson();
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      expect(devDeps).not.toContain('@vybestack/llxprt-code-providers');
    });

    it('has no @vybestack/llxprt-code (cli) in devDependencies', () => {
      const pkg = loadPackageJson();
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      expect(devDeps).not.toContain('@vybestack/llxprt-code');
    });

    it('test-utils is acceptable in devDependencies', () => {
      const pkg = loadPackageJson();
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      expect(devDeps).toContain('@vybestack/llxprt-code-test-utils');
    });
  });

  describe('no forbidden dependency in any dependency field', () => {
    it('no forbidden package appears anywhere in the dependency graph', () => {
      const pkg = loadPackageJson();
      const allDeps = collectAllDepNames(pkg);
      for (const forbidden of FORBIDDEN_IN_ALL) {
        expect(allDeps).not.toContain(forbidden);
      }
    });
  });

  describe('anti-cycle verifier: forbidden monorepo packages must not appear in tools dependencies', () => {
    it('no forbidden monorepo package in dependencies or devDependencies', () => {
      const pkg = loadPackageJson();
      const allDepEntries = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      for (const forbidden of FORBIDDEN_IN_ALL) {
        expect(allDepEntries).not.toHaveProperty(forbidden);
      }
    });
  });

  describe('zod-to-json-schema is declared in dependencies', () => {
    it('has zod-to-json-schema in dependencies', () => {
      const pkg = loadPackageJson();
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.dependencies!['zod-to-json-schema']).toBeDefined();
    });
  });
});
