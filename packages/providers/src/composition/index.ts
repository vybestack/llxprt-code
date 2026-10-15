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
  createProviderManager,
  populateProviderManager,
  refreshAliasProviders,
  bindOpenAIAliasIdentity,
} from './providerManagerInstance.js';

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
  bindAliasMediaTransportCapabilities,
  resolveAliasEnvApiKey,
  enforceAliasAuthOnly,
  createOpenAIAliasProvider,
  createOpenAIResponsesAliasProvider,
  createOpenAIVercelAliasProvider,
  createAnthropicAliasProvider,
  registerAliasProviders,
  listProviderAliasNames,
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
  RegisteredMcpAuthFactory,
  RuntimeContributedAlias,
  RuntimeMcpAuthFactoryContribution,
  RuntimePluginManifest,
  RuntimeProviderContribution,
} from './runtimePlugins/index.js';

// ─── OAuth provider registration ─────────────────────────────────────────────
export {
  ensureOAuthProviderRegistered,
  registerStandardOAuthProviders,
  isOAuthProviderRegistered,
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

export { extractProviderBaseUrl } from '../baseUrlResolver.js';

export { createOwnedOAuthManager } from './providerManagerInstance.js';
export { createOwnerOAuthManager } from './owner-oauth-construction.js';
export { createSessionAuthPolicyReader } from '../auth/session-auth-policy.js';
export { createOAuthProfileReads } from '../auth/oauth-profile-reads.js';
export { createPreflightOAuthProfileReads } from '../auth/preflight-oauth-profile-reads.js';
export { createOwnerAuthCacheInvalidator } from '../auth/owner-cache-invalidation.js';
export { createOwnedTokenStoreClose } from '../auth/proxy/credential-store-factory.js';
