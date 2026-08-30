/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider composition public API — the ProviderManager construction, provider
 * registration, alias resolution, and credential-precedence logic relocated to
 * the providers package.
 *
 * Exposed via the `@vybestack/llxprt-code-providers/composition.js` subpath
 * entry.
 */

// ─── ProviderManager construction & lifecycle ────────────────────────────────
export {
  configureProviderRuntimeFactories,
  setFileSystem,
  createProviderManager,
  registerProviderManagerSingleton,
  getProviderManager,
  resetProviderManager,
  getOAuthManager,
  refreshAliasProviders,
  bindOpenAIAliasIdentity,
  providerManager,
} from './providerManagerInstance.js';

// ─── Headless construction ───────────────────────────────────────────────────
export { createHeadlessProviderManager } from './headlessFactory.js';
export type { HeadlessProviderManagerOptions } from './headlessFactory.js';

// ─── Provider aliases ────────────────────────────────────────────────────────
export {
  getUserAliasDir,
  loadProviderAliasEntries,
  getAliasFilePath,
  writeProviderAliasConfig,
  computeUnallowedParameters,
} from './providerAliases.js';
export type {
  ProviderAliasSource,
  StaticModelEntry,
  ModelDefaultRule,
  ProviderAliasConfig,
  ProviderAliasEntry,
} from './providerAliases.js';

// ─── Alias provider factory ──────────────────────────────────────────────────
export {
  sanitizeApiKey,
  isAliasDefaultModelProvider,
  overrideAliasDefaultModel,
  bindProviderAliasIdentity,
  createOpenAIAliasProvider,
  createOpenAIResponsesAliasProvider,
  createOpenAIVercelAliasProvider,
  createGeminiAliasProvider,
  createAnthropicAliasProvider,
  registerAliasProviders,
} from './aliasProviderFactory.js';
export type {
  AliasAwareBaseProvider,
  RegisterAliasProvidersOptions,
} from './aliasProviderFactory.js';

// ─── Runtime plugins (issue #2758) ───────────────────────────────────────────
export {
  createBuiltinProviderContributions,
  createBuiltinProviderContributionRegistry,
  buildProviderContributionRegistry,
  discoverRuntimePluginPackages,
  resolvePluginSearchRoot,
  RUNTIME_PLUGIN_MANIFEST_MARKER,
  loadRuntimePlugins,
  loadInstalledRuntimePlugins,
  parseRuntimePluginManifest,
  RUNTIME_PLUGIN_SUPPORTED_API_VERSION,
  RuntimePluginIncompatibleError,
  RuntimePluginMalformedError,
} from './runtimePlugins/index.js';
export type {
  ContributedAliasRegistration,
  RuntimePluginDiscoveryDeps,
  LoadedRuntimePlugin,
  ProviderAliasFactory,
  ProviderContributionOrigin,
  ProviderContributionRegistry,
  ProviderFactoryContext,
  RuntimeContributedAlias,
  RuntimePluginManifest,
  RuntimeProviderContribution,
} from './runtimePlugins/index.js';

// ─── OAuth provider registration ─────────────────────────────────────────────
export {
  ensureOAuthProviderRegistered,
  registerStandardOAuthProviders,
  isOAuthProviderRegistered,
  resetRegisteredProviders,
} from './oauth-provider-registration.js';

// ─── Credential precedence ───────────────────────────────────────────────────
export { resolveCredentialPrecedence } from './credentialPrecedence.js';
export type {
  CredentialInputs,
  CredentialPrecedenceResult,
} from './credentialPrecedence.js';

// ─── File system abstraction ─────────────────────────────────────────────────
export { NodeFileSystem, MockFileSystem } from './IFileSystem.js';
export type { IFileSystem } from './IFileSystem.js';

// ─── Composition types ───────────────────────────────────────────────────────
export { ContentGeneratorRole } from './types.js';
