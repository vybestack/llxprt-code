/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exact allowlist data for the provider-agnostic naming architecture gate.
 * Extracted into a separate module so the test file stays under max-lines.
 *
 * ALL entries are generated from a full workspace scan and correspond to
 * genuine Gemini references (provider, API key/model/env vars, @google/genai
 * wire-format concepts, .geminiignore/GEMINI.md paths, privacy notice,
 * content conversion, direct overrides, token extraction).
 */

/** Genuine Gemini provider/concept directory trees (root-relative prefix predicates). */
export const GENUINE_GEMINI_TREES: readonly string[] = [
  'providers/src/gemini/',
  'core/src/code_assist/',
  'core/src/prompt-config/defaults/providers/gemini/',
];

/** Exact genuine Gemini source files (not whole directories). */
export const GENUINE_GEMINI_FILES: readonly string[] = [
  'core/src/llm-types/geminiContent.ts',
  'core/src/llm-types/finishReasons.ts',
  'providers/src/auth/gemini-oauth-provider.ts',
  'providers/src/auth/gemini-oauth-provider.test.ts',
  'providers/src/ProviderManager.gemini-switch.test.ts',
  'providers/src/composition/provider-gemini-switching.test.ts',
];

/** Exact (relativePath, identifier) pairs for declared identifiers. */
export const ALLOWED_GEMINI_PAIRS: readonly string[] = [
  'core/src/services/history/ContentConverters.test.ts::geminiContent',
  'core/src/services/history/ContentConverters.test.ts::geminiInput',
  'core/src/services/history/ContentConverters.test.ts::gemini',
  'cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts::geminiWork',
  'cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts::geminiPersonal',
  'cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts::geminiBuckets',
  'cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts::geminiToken',
  'cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts::geminiStillExists',
  'cli/src/integration-tests/provider-switching.integration.test.ts::geminiProvider',
  'cli/src/integration-tests/provider-switching.integration.test.ts::geminiSettings',
  'cli/src/providers/logging/multi-provider-logging.integration.test.ts::geminiProvider',
  'cli/src/providers/logging/multi-provider-logging.integration.test.ts::geminiWrapper',
  'cli/src/ui/oauth-submission.test.ts::geminiProvider',
  'cli/src/integration-tests/cli-args.profile-flag.integration.test.ts::expectGeminiProviderAttempt',
  'auth/src/__tests__/auth-integration.spec.ts::geminiResolver',
  'auth/src/__tests__/auth-integration.spec.ts::geminiResult',
  'auth/src/__tests__/auth-integration.spec.ts::geminiAuth',
  'auth/src/__tests__/invalidateProviderCache.test.ts::geminiCallCount',
  'auth/src/__tests__/invalidateProviderCache.test.ts::geminiResolver',
  'auth/src/__tests__/invalidateProviderCache.test.ts::geminiToken1',
  'auth/src/__tests__/invalidateProviderCache.test.ts::geminiToken2',
  'auth/src/__tests__/token-store.spec.ts::_validGeminiToken',
  'auth/src/__tests__/token-store.spec.ts::geminiToken',
  'auth/src/__tests__/token-store.spec.ts::geminiBuckets',
  'providers/src/composition/aliasProviderFactory.ts::createGeminiAliasProvider',
  'providers/src/composition/aliasProviderFactory.ts::GeminiProvider',
  'providers/src/composition/index.ts::createGeminiAliasProvider',
  'providers/src/index.ts::GeminiProvider',
  'providers/src/integration/multi-provider.integration.test.ts::savedGeminiKey',
  'providers/src/auth/oauth-manager.spec.ts::geminiProvider',
  'providers/src/auth/oauth-manager.spec.ts::geminiResult',
  'providers/src/auth/oauth-manager.spec.ts::geminiStatus',
  'providers/src/auth/__tests__/auth-status-service.spec.ts::geminiCoreProvider',
  'providers/src/auth/__tests__/OAuthBucketManager.spec.ts::geminiToken',
  'providers/src/auth/__tests__/OAuthBucketManager.spec.ts::geminiStatus',
  'providers/src/auth/proxy/__tests__/e2e-credential-flow.test.ts::geminiToken',
  'providers/src/auth/proxy/__tests__/refresh-coordinator.test.ts::geminiResult',
  'providers/src/auth/proxy/__tests__/refresh-flow.spec.ts::geminiProvider',
  'providers/src/auth/proxy/__tests__/refresh-flow.spec.ts::gemini',
  'providers/src/__tests__/LoadBalancingProvider.delegation.test.ts::mockGeminiProvider',
  'providers/src/__tests__/LoadBalancingProvider.delegation.test.ts::mockGemini',
  'providers/src/composition/providerManagerInstance.oauthRegistration.test.ts::MockGeminiProvider',
  'providers/src/composition/providerManagerInstance.oauthRegistration.test.ts::geminiCtorState',
  'providers/src/composition/providerManagerInstance.oauthRegistration.test.ts::geminiCtor',
  'providers/src/composition/providerManagerInstance.schemaDefaults.test.ts::MockGeminiProvider',
];

/** Extended pairs discovered by the improved scanner (object-literal, type params). */
export const ALLOWED_GEMINI_PAIRS_EXTENDED: readonly string[] = [
  'agents/src/core/DirectMessageProcessor.ts::geminiDirectOverrides',
  'cli/src/utils/sandbox-containers.ts::GEMINI_API_KEY',
  'cli/src/utils/sandbox-containers.ts::GEMINI_MODEL',
  'cli/src/auth/oauth-settings-adapter.spec.ts::gemini',
  // PROVIDER_INFO record key carrying the gemini provider's consent content,
  // folded in from the deleted GeminiPrivacyNotice component (#2628). This
  // is provider-id data (permitted 'gemini' literal), not a wire rename.
  'cli/src/ui/privacy/MultiProviderPrivacyNotice.tsx::gemini',
  'cli/src/ui/components/ProfileCreateWizard/constants.ts::gemini',
  'cli/src/ui/components/WelcomeOnboarding/AuthMethodStep.tsx::gemini',
  'cli/src/ui/components/WelcomeOnboarding/ProviderSelectStep.tsx::gemini',
  'core/src/models/provider-integration.ts::gemini',
  'core/src/integration-tests/profile-integration.test.ts::gemini',
  'core/src/services/history/IContent.providerMetadata.test.ts::gemini',
  'providers/src/providerCapabilitiesService.ts::gemini',
  'providers/src/auth/__tests__/provider-registry.spec.ts::gemini',
  'providers/src/auth/file-oauth-settings.test.ts::gemini',
  'providers/src/composition/providerManagerInstance.oauthRegistration.test.ts::GeminiProvider',
  'providers/src/composition/providerManagerInstance.schemaDefaults.test.ts::GeminiProvider',
  'providers/src/runtime/provider-alias-defaults.modeldefaults.test.ts::gemini',
  'providers/src/runtime/provider-alias-defaults.propagation.test.ts::gemini',
  'providers/src/runtime/provider-alias-defaults.switch.test.ts::gemini',
];

/** Exact (relPath, moduleSpecifier, importedSymbol, localName) 4-tuples. */
export const ALLOWED_IMPORT_TUPLES: readonly string[] = [
  'core/src/services/history/ContentConverters.test.ts::../../llm-types/geminiContent.js::GeminiContent::GeminiContent',
  'core/src/services/history/ContentConverters.ts::../../llm-types/geminiContent.js::GeminiContent::GeminiContent',
  'core/src/services/history/ContentConverters.ts::../../llm-types/geminiContent.js::GeminiContentPart::GeminiContentPart',
  'providers/src/composition/aliasProviderFactory.authOnly.test.ts::./aliasProviderFactory.js::createGeminiAliasProvider::createGeminiAliasProvider',
  'providers/src/composition/aliasProviderFactory.ts::../gemini/GeminiProvider.js::GeminiProvider::GeminiProvider',
  // The built-in provider contribution table enumerates every built-in
  // provider, Gemini included, and delegates to the existing alias factory.
  'providers/src/composition/runtimePlugins/builtinContributions.ts::../aliasProviderFactory.js::createGeminiAliasProvider::createGeminiAliasProvider',
  // The neutral dump dispatcher pulls the Gemini dump conversion directly
  // from the provider implementation tree (#2628); the barrel export is gone.
  'providers/src/utils/providerRequestConversion.ts::../gemini/geminiDumpConversion.js::buildGeminiDumpContents::buildGeminiDumpContents',
  'providers/src/utils/providerRequestConversion.ts::../gemini/geminiDumpConversion.js::isGeminiCompatibleProvider::isGeminiCompatibleProvider',
];

/** Exact (relPath, moduleSpecifier, originalSymbol, exportedName) 4-tuples. */
export const ALLOWED_EXPORT_TUPLES: readonly string[] = [
  'providers/src/composition/index.ts::./aliasProviderFactory.js::createGeminiAliasProvider::createGeminiAliasProvider',
  'providers/src/index.ts::./gemini/GeminiProvider.js::GeminiProvider::GeminiProvider',
];
