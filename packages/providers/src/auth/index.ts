/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auth cluster public API — the OAuth/auth subsystem relocated to the providers package.
 *
 * Exposed via the `@vybestack/llxprt-code-providers/auth.js` subpath entry.
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  OAuthToken,
  AuthStatus,
  TokenStore,
  OAuthTokenRequestMetadata,
} from './types.js';
export type {
  OAuthManagerRuntimeMessageBusDeps,
  OAuthProvider,
  AuthCompletionOptions,
  AuthenticatorInterface,
  BucketFailoverOAuthManagerLike,
} from './types.js';
export { KeyringTokenStore } from './types.js';

// ─── OAuth Manager ───────────────────────────────────────────────────────────
export { OAuthManager } from './oauth-manager.js';

// ─── Provider Registry ───────────────────────────────────────────────────────
export { ProviderRegistry } from './provider-registry.js';

// ─── Auth Flow / Status / Renewal ────────────────────────────────────────────
export { AuthFlowOrchestrator } from './auth-flow-orchestrator.js';
export { AuthStatusService } from './auth-status-service.js';
export {
  ProactiveRenewalManager,
  MAX_PROACTIVE_RENEWAL_FAILURES,
} from './proactive-renewal-manager.js';
export { TokenAccessCoordinator } from './token-access-coordinator.js';
export { OAuthBucketManager } from './OAuthBucketManager.js';

// ─── OAuth Providers ─────────────────────────────────────────────────────────
export { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';
export { CodexOAuthProvider } from './codex-oauth-provider.js';

// ─── Usage Info ──────────────────────────────────────────────────────────────
export {
  getAnthropicUsageInfo,
  getAllAnthropicUsageInfo,
  getAllCodexUsageInfo,
  getAllCodexRateLimitResetCredits,
  getHigherPriorityAuth,
} from './provider-usage-info.js';

// ─── Proxy Credential Store Factory ──────────────────────────────────────────
export {
  createTokenStore,
  createProviderKeyStorage,
  createGitHubBrokerSocketClient,
  resetFactorySingletons,
} from './proxy/credential-store-factory.js';

// ─── Clipboard Service ───────────────────────────────────────────────────────
export { ClipboardService } from './ClipboardService.js';

// ─── Runtime Accessor Bridge ─────────────────────────────────────────────────
/**
 * @plan PLAN-20260827-ISSUE2562.P03
 * @requirement REQ-2562-4
 */
export {
  oauthRuntimeBridge,
  DEFAULT_INTERACTIVE_AUTH_TIMEOUT_MS,
} from './runtime-accessor-bridge.js';
export type { OAuthRuntimeAccessors } from './runtime-accessor-bridge.js';

// ─── Interactive Authentication Coordinator ──────────────────────────────────
/**
 * @plan PLAN-20260827-ISSUE2562.P05
 * @requirement REQ-2562-4
 */
export {
  InteractiveAuthCoordinator,
  InteractiveAuthError,
  InteractiveAuthUnavailableError,
  InteractiveAuthHostUnavailableError,
  InteractiveAuthCancelledError,
  interactiveAuthCoordinator,
} from './interactive-auth-coordinator.js';
export type {
  InteractiveAuthChallenge,
  InteractiveAuthHostHandler,
  InteractiveAuthOutcome,
  InteractiveAuthOutcomeKind,
} from './interactive-auth-coordinator.js';

// ─── Sandbox Proxy Lifecycle ─────────────────────────────────────────────────
export {
  createAndStartProxy,
  stopProxy,
  getProxySocketPath,
  getProxyCapabilityToken,
} from './proxy/sandbox-proxy-lifecycle.js';
export type {
  SandboxProxyConfig,
  SandboxProxyHandle,
} from './proxy/sandbox-proxy-lifecycle.js';

/**
 * Brokered GitHub operations. `executeGitHubOp` is the shared dispatch used
 * by both the socket handler and the in-process host path.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-003, REQ-004
 */
export {
  createGitHubBrokerHandler,
  executeGitHubOp,
} from './proxy/github-broker.js';

// ─── File-backed OAuth Settings Provider ─────────────────────────────────────
// Isolated-runtime OAuth enablement surface: reads the user-scope global
// settings file so provider instances built outside the CLI (subagents /
// isolated runtimes) can consult oauthEnabledProviders and shared-keychain
// tokens.
export { createFileOAuthSettingsProvider } from './file-oauth-settings.js';

// ─── Browser Profile Association Store ───────────────────────────────────────
export { BrowserProfileAssociationStore } from './browser-profile-association-store.js';
export type {
  BrowserProfileAssociation,
  AssociationStoreFs,
} from './browser-profile-association-store.js';

// ─── Browser Profile Association Store Singleton (runtime layer) ─────────────
export { getBrowserProfileAssociationStore } from '../runtime/browser-profile-association-store-instance.js';
