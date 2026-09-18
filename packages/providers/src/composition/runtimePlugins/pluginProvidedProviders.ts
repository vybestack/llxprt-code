/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider ids whose implementation lives exclusively in an optional runtime
 * plugin, mapped to the first-party package that provides it (issue #2763).
 *
 * This is data, not an import: the base package must not depend on plugin
 * code, so a base-only install cannot learn the mapping from the plugin
 * itself. When alias construction hits one of these ids with no factory
 * present, the error names the exact package to install instead of leaving
 * the user to guess where the provider went. Pinned from the base side by the
 * layout suite (scripts/tests/issue-2603-plugin-install-layouts.test.ts) and
 * from the plugin side by scripts/tests/plugins-topology.test.ts.
 */
export const PLUGIN_PROVIDED_PROVIDER_HINTS: Readonly<Record<string, string>> =
  {
    gemini: '@vybestack/llxprt-plugin-google-gemini',
  };

/**
 * Returns the installable plugin package that provides `providerId`, or
 * undefined when the id is not a known plugin-provided capability. Lookups
 * are case-insensitive to match the provider contribution registry.
 */
export function pluginProvidedProviderHint(
  providerId: string,
): string | undefined {
  return PLUGIN_PROVIDED_PROVIDER_HINTS[providerId.toLowerCase()];
}
