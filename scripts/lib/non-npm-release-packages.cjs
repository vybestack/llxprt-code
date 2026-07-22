'use strict';

/**
 * Shared list of workspace packages that are NOT published to NPM by the
 * release pipeline.
 *
 * Canonical source: scripts/utils/release-packages.ts (TypeScript). Because
 * .cjs scripts cannot import .ts modules without a build step, this .cjs
 * mirror exists so both release-pack.cjs and release-install-smoke.cjs import
 * a single shared definition rather than each duplicating the list. If the
 * canonical TypeScript set changes, update this mirror to match.
 *
 * The release-pack.cjs test also validates that this list matches the
 * TypeScript source at runtime by reading the compiled module.
 */

const NON_NPM_RELEASE_PACKAGES = new Set([
  '@vybestack/llxprt-code-test-utils',
  '@vybestack/llxprt-code-a2a-server',
  'llxprt-code-vscode-ide-companion',
]);

module.exports = { NON_NPM_RELEASE_PACKAGES };
