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

/**
 * First-party runtime plugin packages (issue #2759) in deterministic
 * publication order. Release automation publishes these AFTER every base
 * workspace package and the CLI, because each plugin peer-depends on host
 * packages that must already be present on the registry. The list is explicit:
 * plugins are never discovered by scanning the `plugins/` directory, and the
 * plugin contexts intentionally sit outside the root workspaces.
 */
export interface FirstPartyRuntimePluginRelease {
  readonly name: string;
  /** Repo-relative package directory, outside the root workspaces. */
  readonly dir: string;
}

export const FIRST_PARTY_RUNTIME_PLUGIN_RELEASES: readonly FirstPartyRuntimePluginRelease[] =
  [
    {
      name: '@vybestack/llxprt-plugin-google-gemini',
      dir: 'plugins/google-gemini',
    },
    {
      name: '@vybestack/llxprt-plugin-google-mcp-auth',
      dir: 'plugins/google-mcp-auth',
    },
  ];

/**
 * The release.yml step-name prefix for a plugin publish step. The topology
 * test uses it (concatenated with the package name, which already carries the
 * `@vybestack/` scope) to keep release.yml's explicit plugin list aligned
 * with this module, so the two cannot drift apart.
 */
export const RELEASE_PUBLISH_STEP_PREFIX = 'Publish ';
