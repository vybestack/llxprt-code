/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { createBuiltinProviderContributions } from './builtinContributions.js';
export {
  buildProviderContributionRegistry,
  createBuiltinProviderContributionRegistry,
} from './registry.js';
export {
  loadRuntimePlugins,
  loadInstalledRuntimePlugins,
} from './loadRuntimePlugins.js';
export {
  discoverRuntimePluginPackages,
  resolvePluginSearchRoot,
  RUNTIME_PLUGIN_MANIFEST_MARKER,
} from './discoverRuntimePlugins.js';
export type { RuntimePluginDiscoveryDeps } from './discoverRuntimePlugins.js';
export {
  parseRuntimePluginManifest,
  RUNTIME_PLUGIN_SUPPORTED_API_VERSION,
  RuntimePluginIncompatibleError,
  RuntimePluginMalformedError,
} from './manifest.js';
export type {
  ContributedAliasRegistration,
  LoadedRuntimePlugin,
  ProviderAliasFactory,
  ProviderContributionOrigin,
  ProviderContributionRegistry,
  ProviderFactoryContext,
  RuntimeContributedAlias,
  RuntimePluginManifest,
  RuntimeProviderContribution,
} from './types.js';
