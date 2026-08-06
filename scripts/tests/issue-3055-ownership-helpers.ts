/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3055 — shared ownership-invariant helper.
 *
 * The invariant: every module the CLI bundle marks external must be a declared
 * direct dependency of the published package (`packages/cli/package.json`),
 * otherwise its runtime resolution from `<pkg>/bundle/llxprt.js` is not
 * guaranteed by any package manager.
 *
 * This module holds the SINGLE implementation of that check. Both the primary
 * ownership test (fed the real `CLI_DIRNAME_DEPENDENT_EXTERNALS`) and the
 * config-chain regression test (fed `['config-chain']`) call the same
 * `findOwnershipViolations`, so they exercise one piece of logic — never a
 * duplicated predicate that could drift from the real guard.
 *
 * This lives in a test helper module — NOT in `scripts/bun-build.config.ts` —
 * because the ownership rule is a *verification* concern *about* the build
 * config, not build configuration itself. `bun-build.config.ts` defines the
 * externals lists; this module verifies an invariant about them, keeping the
 * production config focused on bundling.
 */

/**
 * Extracts the bare package name from an external specifier.
 *
 * - Scoped: `@scope/name/sub` -> `@scope/name`
 * - Scoped (no subpath): `@scope/name` -> `@scope/name`
 * - Unscoped: `name/sub` -> `name`
 * - Unscoped (no subpath): `name` -> `name`
 * - `node:` builtins: returned as-is (they are never in package.json deps).
 */
export function packageName(specifier: string): string {
  if (specifier.startsWith('node:')) {
    return specifier;
  }
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

/**
 * Return every external whose bare package name is NOT present in
 * `declaredDependencies`.
 *
 * Each returned entry is the original external specifier (not the normalised
 * package name), so a violation names the exact `require()` target that lacks
 * a declared owner.
 *
 * @param externals - The external specifiers to check (e.g. a bundle config's
 *   `external` array, or a synthetic list like `['config-chain']`).
 * @param declaredDependencies - The set of bare package names the owning
 *   manifest declares as direct dependencies (e.g. the keys of
 *   `packages/cli/package.json#dependencies`).
 * @returns The externals that violate the ownership invariant (empty array if
 *   all externals are declared direct dependencies).
 */
export function findOwnershipViolations(
  externals: readonly string[],
  declaredDependencies: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  for (const external of externals) {
    const pkg = packageName(external);
    if (!declaredDependencies.has(pkg)) {
      violations.push(external);
    }
  }
  return violations;
}
