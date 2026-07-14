/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-PKG-BOUNDARY
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boundary Scan Tests
 *
 * Verifies that packages/tools/src has zero forbidden imports
 * from core, cli, or providers packages. Also verifies package.json
 * has no forbidden dependencies and test-utils is devDependency-only.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// toolsRoot points to the packages/tools root (2 levels up from __tests__)
const toolsRoot = resolve(import.meta.dirname, '..', '..');

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

describe('Boundary Scan Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  describe('packages/tools/src must not import core/cli/providers modules', () => {
    for (const pkgId of FORBIDDEN_PACKAGE_IDS) {
      it(`production source must not import from ${pkgId}`, () => {
        let found = false;
        try {
          const result = execSync(
            `rg -n "(^\\s*import\\s+.*from\\s+['\\"]${pkgId}|^\\s*import\\s+['\\"]${pkgId}|^\\s*import\\(['\\"]${pkgId})" "${join(toolsRoot, 'src')}" --type ts --glob "!**/__tests__/**" --no-heading`,
            {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 10_000,
            },
          );
          found = result.trim().length > 0;
        } catch {
          // rg exits code 1 when no matches — that's the passing case
        }
        expect(found).toBe(false);
      });
    }

    for (const prefix of FORBIDDEN_PATH_PREFIXES) {
      it(`production source must not import from ${prefix}`, () => {
        let found = false;
        try {
          const result = execSync(
            `rg -n "(^\\s*import\\s+.*from\\s+['\\"].*${prefix}|^\\s*import\\s+['\\"].*${prefix}|^\\s*import\\(['\\"].*${prefix})" "${join(toolsRoot, 'src')}" --type ts --glob "!**/__tests__/**" --no-heading`,
            {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 10_000,
            },
          );
          found = result.trim().length > 0;
        } catch {
          // rg exits code 1 when no matches — that's the passing case
        }
        expect(found).toBe(false);
      });
    }
  });

  describe('package.json dependency constraints', () => {
    it('has no core/providers/cli dependencies', () => {
      const pkgPath = join(toolsRoot, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = Object.keys(pkg.dependencies ?? {});
      for (const forbidden of FORBIDDEN_PACKAGE_IDS) {
        expect(deps).not.toContain(forbidden);
      }
    });

    it('devDependencies may only contain @vybestack/llxprt-code-test-utils from monorepo', () => {
      const pkgPath = join(toolsRoot, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      const forbiddenInDev = [
        '@vybestack/llxprt-code-core',
        '@vybestack/llxprt-code-providers',
        '@vybestack/llxprt-code-cli',
      ];
      for (const f of forbiddenInDev) {
        expect(devDeps).not.toContain(f);
      }
    });
  });

  describe('moved modules exist in tools package', () => {
    it('tools package has its own copy of all moved modules', () => {
      const movedModules = [
        { name: 'doubleEscapeUtils.ts', dir: 'formatters' },
        { name: 'toolIdNormalization.ts', dir: 'formatters' },
        { name: 'ToolFormatter.ts', dir: 'formatters' },
        { name: 'IToolFormatter.ts', dir: 'formatters' },
        { name: 'ToolIdStrategy.ts', dir: 'formatters' },
        { name: 'toolNameUtils.ts', dir: 'formatters' },
        { name: 'mediaUtils.ts', dir: 'utils' },
        { name: 'tool-error.ts', dir: 'types' },
        { name: 'tool-confirmation-types.ts', dir: 'types' },
        { name: 'tool-names.ts', dir: 'types' },
      ];

      for (const mod of movedModules) {
        const modulePath = join(toolsRoot, 'src', mod.dir, mod.name);
        expect(existsSync(modulePath)).toBe(true);
      }
    });
  });

  describe('test-utils is devDependency-only', () => {
    it('@vybestack/llxprt-code-test-utils appears only in devDependencies', () => {
      const pkgPath = join(toolsRoot, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = Object.keys(pkg.dependencies ?? {});
      expect(deps).not.toContain('@vybestack/llxprt-code-test-utils');

      const devDeps = Object.keys(pkg.devDependencies ?? {});
      expect(devDeps).toContain('@vybestack/llxprt-code-test-utils');
    });
  });
});
