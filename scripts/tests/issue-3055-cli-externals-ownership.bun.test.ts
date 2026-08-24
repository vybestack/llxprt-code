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
  EXTERNALS,
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
    // If CLI_DIRNAME_DEPENDENT_EXTERNALS were emptied during a refactor of
    // bun-build.config.ts, the ownership test would find zero violations
    // (vacuous pass) and the loop below would run zero times (vacuous pass
    // too). Assert the list is populated so the guard cannot be silently
    // turned off without failing this test.
    expect(CLI_DIRNAME_DEPENDENT_EXTERNALS.length).toBeGreaterThan(0);
    for (const entry of CLI_DIRNAME_DEPENDENT_EXTERNALS) {
      expect(cliBundleConfig.external).toContain(entry);
    }
  });
});

/**
 * Externals that are legitimately NOT direct dependencies of packages/cli.
 * Every entry needs a reason; anything not listed here must be declared.
 */
const EXTERNALS_NOT_OWNED_BY_CLI: ReadonlySet<string> = new Set([
  // Node builtins resolve from the runtime, never from node_modules.
  'node:module',
  // Platform-specific optional binaries that @lydell/node-pty resolves
  // itself through its own optionalDependencies at install time.
  '@lydell/node-pty-darwin-arm64',
  '@lydell/node-pty-darwin-x64',
  '@lydell/node-pty-linux-x64',
  '@lydell/node-pty-win32-arm64',
  '@lydell/node-pty-win32-x64',
  // The UI is a separate product, installed alongside (the sandbox image
  // installs it in its own npm transaction), and the CLI degrades when
  // it is absent.
  '@vybestack/llxprt-ui',
  '@vybestack/opentui-core',
  '@vybestack/opentui-react',
  // Optional watcher the runtime falls back from to fs.watch at launch.
  'chokidar',
]);

describe('sandbox-image defect class: shared EXTERNALS are owned or explicitly exempt', () => {
  // The sandbox images shipped for weeks with a CLI that crashed at startup
  // inside the container ("Cannot find module '@ast-grep/napi'"): the bundle
  // externalizes native addons in the shared EXTERNALS list, but the
  // published package did not declare them, so an install tree that nests
  // instead of hoists (the image's multi-tarball global install) left them
  // unresolvable. This closes that gap: every shared external must either be
  // a declared direct dependency of packages/cli or carry an explicit,
  // justified exemption above.
  it('every EXTERNALS entry is a direct dependency of packages/cli or explicitly exempt', () => {
    const cliPackage = readPackageJson('packages/cli/package.json');
    // Optional dependencies install by default and satisfy runtime
    // resolution the same way mandatory ones do; the publish-integrity
    // (S6) contract requires platform-conditional natives (node-pty,
    // @napi-rs/keyring) to stay optional, mirroring the root manifest.
    const cliDeps = new Set([
      ...Object.keys(cliPackage.dependencies ?? {}),
      ...Object.keys(cliPackage.optionalDependencies ?? {}),
    ]);
    const owned = EXTERNALS.filter((e) => !EXTERNALS_NOT_OWNED_BY_CLI.has(e));
    expect(owned.length).toBeGreaterThan(0);

    const violations = findOwnershipViolations(owned, cliDeps);
    expect(
      violations,
      `CLI bundle external(s) not declared as direct dependencies of ` +
        `packages/cli/package.json and not exempt in ` +
        `EXTERNALS_NOT_OWNED_BY_CLI — their runtime resolution from ` +
        `<pkg>/bundle/llxprt.js is not guaranteed when the install tree ` +
        `nests instead of hoists (the sandbox image defect).\n` +
        `Offending: ${violations.join(', ')}`,
    ).toEqual([]);
  });

  it('the guard would have caught the shipped ast-grep defect', () => {
    // Simulate the pre-fix manifest: strip the ast-grep deps and confirm
    // the real helper flags the externalized packages, so this guard can
    // never silently vacuous-pass if EXTERNALS or the manifest drift apart.
    const cliPackage = readPackageJson('packages/cli/package.json');
    const cliDeps = new Set(
      Object.keys(cliPackage.dependencies ?? {}).filter(
        (d) => !d.startsWith('@ast-grep/'),
      ),
    );
    const violations = findOwnershipViolations(
      ['@ast-grep/napi', '@ast-grep/lang-python'],
      cliDeps,
    );
    expect(violations).toEqual(['@ast-grep/napi', '@ast-grep/lang-python']);
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
