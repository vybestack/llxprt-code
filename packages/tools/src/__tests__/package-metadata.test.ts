/**
 * @plan:PLAN-20260608-ISSUE1585.P07
 * @requirement:REQ-REL-001, REQ-PKG-001
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package Metadata Tests
 *
 * Verifies the actual content of packages/tools/package.json to ensure
 * the tools package has correct publishable metadata, entry points,
 * scripts, and no forbidden runtime dependencies.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const toolsRoot = resolve(import.meta.dirname, '../..');
const packageJsonPath = resolve(toolsRoot, 'package.json');

interface PackageJson {
  name: string;
  version: string;
  description: string;
  license: string;
  type: string;
  main: string;
  types: string;
  exports: Record<string, Record<string, string>>;
  scripts: Record<string, string>;
  files: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
  repository?: { type: string; url: string };
}

function loadPackageJson(): PackageJson {
  const raw = readFileSync(packageJsonPath, 'utf-8');
  return JSON.parse(raw);
}

describe('Package Metadata Tests @plan:PLAN-20260608-ISSUE1585.P07', () => {
  describe('package identity and type', () => {
    it('has correct scoped package name', () => {
      const pkg = loadPackageJson();
      expect(pkg.name).toBe('@vybestack/llxprt-code-tools');
    });

    it('has type module', () => {
      const pkg = loadPackageJson();
      expect(pkg.type).toBe('module');
    });

    it('has a description', () => {
      const pkg = loadPackageJson();
      expect(pkg.description).toBeTruthy();
      expect(pkg.description.length).toBeGreaterThan(0);
    });

    it('has Apache-2.0 license', () => {
      const pkg = loadPackageJson();
      expect(pkg.license).toBe('Apache-2.0');
    });

    it('has a version string', () => {
      const pkg = loadPackageJson();
      expect(typeof pkg.version).toBe('string');
      expect(pkg.version.length).toBeGreaterThan(0);
    });
  });

  describe('entry points', () => {
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
      const exports = pkg.exports;
      expect(exports).toBeDefined();
      const dotExport = exports['.'];
      expect(dotExport).toBeDefined();
      expect(dotExport.types).toBe('./dist/index.d.ts');
      expect(dotExport.import).toBe('./dist/index.js');
    });
  });

  describe('scripts', () => {
    it('has build script', () => {
      const pkg = loadPackageJson();
      expect(pkg.scripts.build).toBeDefined();
      expect(typeof pkg.scripts.build).toBe('string');
    });

    it('has lint script', () => {
      const pkg = loadPackageJson();
      expect(pkg.scripts.lint).toBeDefined();
    });

    it('has format script', () => {
      const pkg = loadPackageJson();
      expect(pkg.scripts.format).toBeDefined();
    });

    it('has test script', () => {
      const pkg = loadPackageJson();
      expect(pkg.scripts.test).toBeDefined();
    });

    it('has typecheck script', () => {
      const pkg = loadPackageJson();
      expect(pkg.scripts.typecheck).toBeDefined();
    });
  });

  describe('engines and files', () => {
    it('requires node >= 20', () => {
      const pkg = loadPackageJson();
      expect(pkg.engines).toBeDefined();
      expect(pkg.engines.node).toBe('>=20');
    });

    it('includes dist in files array', () => {
      const pkg = loadPackageJson();
      expect(pkg.files).toBeDefined();
      expect(pkg.files).toContain('dist');
    });
  });

  describe('no forbidden runtime dependencies', () => {
    it('has no core dependency in dependencies', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies);
      expect(deps).not.toContain('@vybestack/llxprt-code-core');
    });

    it('has no providers dependency in dependencies', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies);
      expect(deps).not.toContain('@vybestack/llxprt-code-providers');
    });

    it('has no cli dependency in dependencies', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies);
      expect(deps).not.toContain('@vybestack/llxprt-code');
    });

    it('dependencies contains only external packages, no monorepo deps', () => {
      const pkg = loadPackageJson();
      const deps = Object.keys(pkg.dependencies);
      const forbidden = [
        '@vybestack/llxprt-code-core',
        '@vybestack/llxprt-code-providers',
        '@vybestack/llxprt-code-cli',
        '@vybestack/llxprt-code',
      ];
      for (const f of forbidden) {
        expect(deps).not.toContain(f);
      }
    });
  });
});
