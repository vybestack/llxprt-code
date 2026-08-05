/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3055 — ownership contract for CLI bundle externals.
 *
 * The invariant: every module the CLI bundle marks external must be a declared
 * direct dependency of the published package (`packages/cli/package.json`),
 * otherwise its runtime resolution from `<pkg>/bundle/llxprt.js` is not
 * guaranteed. A transitive dependency that merely appears somewhere in
 * `node_modules` can be hoisted, shadowed by a consumer's conflicting version,
 * or absent entirely depending on the consumer's install tree — exactly the
 * defect behind issue #3055, where `config-chain` was externalized at the wrong
 * dependency boundary.
 *
 * This test reads the real manifests and asserts the invariant for the
 * CLI-specific external list (`CLI_DIRNAME_DEPENDENT_EXTERNALS`). It is cheap
 * and deterministic: no npm install, no network, no mocks — just JSON.parse of
 * the package manifests that are committed alongside the bundle config.
 *
 * The actual ownership check lives in a single shared helper,
 * `findOwnershipViolations` (see `issue-3055-ownership-helpers.ts`). Both the
 * primary test below and the config-chain regression test feed inputs through
 * that SAME helper, so they exercise one implementation — no duplicated
 * predicate that could drift from the real guard.
 *
 * The pre-existing shared `EXTERNALS` array is NOT checked here: those entries
 * include native addons that are optional/platform-conditional, `node:` builtins
 * that are always available, and packages like `chokidar` that the runtime
 * falls back from at launch time. The ownership invariant does not apply to
 * them in the same strict way, so checking them would require a blanket
 * exclusion list that adds maintenance cost without catching the real hazard.
 * The CLI-specific list is the one where the ownership rule is both necessary
 * and enforceable, because every entry is a package that the bundle emits a
 * bare `require()` for and expects to resolve from the published package's
 * scope.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CLI_DIRNAME_DEPENDENT_EXTERNALS,
  cliBundleConfig,
} from '../bun-build.config.ts';
import { findOwnershipViolations } from './issue-3055-ownership-helpers.ts';

const repoRoot = resolve(import.meta.dir, '..', '..');

interface PackageJson {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

function readPackageJson(relativePath: string): PackageJson {
  return JSON.parse(
    readFileSync(join(repoRoot, relativePath), 'utf8'),
  ) as PackageJson;
}

describe('issue #3055: CLI bundle externals are declared direct dependencies', () => {
  const cliPackage = readPackageJson('packages/cli/package.json');
  const cliDeps = new Set(Object.keys(cliPackage.dependencies ?? {}));

  it('every CLI_DIRNAME_DEPENDENT_EXTERNALS entry is a direct dependency of packages/cli', () => {
    const violations = findOwnershipViolations(
      CLI_DIRNAME_DEPENDENT_EXTERNALS,
      cliDeps,
    );

    expect(
      violations,
      `CLI bundle external(s) not declared as direct dependencies of ` +
        `packages/cli/package.json — their runtime resolution from ` +
        `<pkg>/bundle/llxprt.js is not guaranteed by any package manager.\n` +
        `Offending: ${violations.join(', ')}\n` +
        `Every entry in CLI_DIRNAME_DEPENDENT_EXTERNALS must be a direct ` +
        `dependency of the published package. See the JSDoc on ` +
        `CLI_DIRNAME_DEPENDENT_EXTERNALS in scripts/bun-build.config.ts.`,
    ).toEqual([]);
  });

  it('the full CLI bundle external list is non-empty and includes the dirname-dependent set', () => {
    // Sanity: the config we are guarding is wired up correctly. If the
    // external list were empty, the ownership test would vacuously pass.
    expect(cliBundleConfig.external.length).toBeGreaterThan(0);
    for (const entry of CLI_DIRNAME_DEPENDENT_EXTERNALS) {
      expect(cliBundleConfig.external).toContain(entry);
    }
  });
});

describe('issue #3055: ownership contract would reject the config-chain defect', () => {
  // This proves the test catches the exact defect that was shipped: if someone
  // re-adds `config-chain` (a transitive dependency of @pnpm/npm-conf, NOT a
  // direct dependency of packages/cli), the ownership invariant must fail.
  //
  // The regression feeds `config-chain` through the SAME `findOwnershipViolations`
  // helper the primary test uses — NOT a hand-rolled copy — so a change to the
  // guard's parsing or exclusions would surface here too.
  it('config-chain is NOT a direct dependency of packages/cli (proving the guard would catch it)', () => {
    const cliPackage = readPackageJson('packages/cli/package.json');
    const cliDeps = new Set(Object.keys(cliPackage.dependencies ?? {}));

    expect(cliDeps.has('config-chain')).toBe(false);

    // Feeding config-chain through the REAL guard must flag it as a violation.
    const violations = findOwnershipViolations(['config-chain'], cliDeps);
    expect(violations).toEqual(['config-chain']);
  });
});
