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
export { GeminiOAuthProvider } from './gemini-oauth-provider.js';
export { QwenOAuthProvider } from './qwen-oauth-provider.js';

// ─── Usage Info ──────────────────────────────────────────────────────────────
export {
  getAnthropicUsageInfo,
  getAllAnthropicUsageInfo,
  getAllCodexUsageInfo,
  getAllGeminiUsageInfo,
  getHigherPriorityAuth,
  isQwenCompatibleUrl,
} from './provider-usage-info.js';

// ─── Proxy Credential Store Factory ──────────────────────────────────────────
export {
  createTokenStore,
  createProviderKeyStorage,
  resetFactorySingletons,
} from './proxy/credential-store-factory.js';

// ─── Clipboard Service ───────────────────────────────────────────────────────
export { ClipboardService } from './ClipboardService.js';

// ─── Runtime Accessor Bridge ─────────────────────────────────────────────────
export { oauthRuntimeBridge } from './runtime-accessor-bridge.js';
export type { OAuthRuntimeAccessors } from './runtime-accessor-bridge.js';

// ─── Sandbox Proxy Lifecycle ─────────────────────────────────────────────────
export {
  createAndStartProxy,
  stopProxy,
  getProxySocketPath,
} from './proxy/sandbox-proxy-lifecycle.js';
export type {
  SandboxProxyConfig,
  SandboxProxyHandle,
} from './proxy/sandbox-proxy-lifecycle.js';
