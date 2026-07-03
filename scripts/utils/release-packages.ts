/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workspace packages that are NOT published to NPM by the release pipeline.
 * Shared by scripts/bind-release-deps.ts and scripts/version.ts so the
 * exclusion set cannot drift between the two release tools.
 */
export const NON_NPM_RELEASE_PACKAGES: ReadonlySet<string> = new Set([
  // Keep private workspace packages explicit so their release-binding behavior is
  // covered even if their package metadata changes before publish wiring exists.
  '@vybestack/llxprt-code-test-utils',
  '@vybestack/llxprt-code-a2a-server',
  // Published as a VSIX, not an NPM package.
  'llxprt-code-vscode-ide-companion',
]);

/** The VSIX-published extension still receives version bumps. */
export const VS_CODE_EXTENSION_PACKAGE = 'llxprt-code-vscode-ide-companion';
