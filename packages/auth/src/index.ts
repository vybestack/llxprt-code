/**
 * @plan:PLAN-20260608-ISSUE1586.P03
 * @plan:PLAN-20260608-ISSUE1586.P09
 * @requirement:REQ-AUTH-001.2, REQ-AUTH-001.3, REQ-API-001.4
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Auth package public API — interfaces added in P06, implementations in P09+.

// ─── DI interface exports (type-only) ────────────────────────────────────────
export type * from './interfaces/index.js';

// ─── OAuth UI Event Seam (Phase 1) ───────────────────────────────────────────
export type {
  OAuthUIEvent,
  OAuthUIEventType,
  OAuthUICallback,
} from './oauth-ui-events.js';
export {
  OAuthUIBridge,
  oauthUIBridge,
  OAUTH_UI_MAX_PENDING,
} from './oauth-ui-bridge.js';

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  OAuthToken,
  CodexOAuthToken,
  AuthStatus,
  BucketStats,
  DeviceCodeResponse,
} from './types.js';

export {
  OAuthTokenSchema,
  CodexOAuthTokenSchema,
  AuthStatusSchema,
  BucketStatsSchema,
  DeviceCodeResponseSchema,
} from './types.js';

// ─── Token Store ─────────────────────────────────────────────────────────────
export type { TokenStore } from './token-store.js';

// ─── Keyring Token Store ─────────────────────────────────────────────────────
export { KeyringTokenStore } from './keyring-token-store.js';

// ─── OAuth Errors ────────────────────────────────────────────────────────────
export {
  OAuthError,
  OAuthErrorFactory,
  OAuthErrorCategory,
  OAuthErrorType,
  RetryHandler,
  GracefulErrorHandler,
} from './oauth-errors.js';
export type { RetryConfig } from './oauth-errors.js';

// ─── Token Utilities ─────────────────────────────────────────────────────────
export { mergeRefreshedToken } from './token-merge.js';
export type { OAuthTokenWithExtras } from './token-merge.js';

export { sanitizeTokenForProxy } from './token-sanitization.js';
export type { SanitizedOAuthToken } from './token-sanitization.js';

// ─── Precedence / Auth Resolution ────────────────────────────────────────────
export { AuthPrecedenceResolver } from './auth-precedence-resolver.js';

export {
  flushRuntimeAuthScope,
  resolveProfileId,
  buildCacheKey,
  ensureRuntimeState,
  recordCacheHit,
  recordCacheMiss,
  getValidCachedEntry,
  registerSettingsSubscriptions,
  invalidateMatchingEntries,
  storeRuntimeScopedToken,
  invalidateEntry,
  runtimeScopedStates,
} from './precedence.js';

export type {
  AuthPrecedenceConfig,
  OAuthManager,
  OAuthTokenRequestMetadata,
  RuntimeAuthScopeFlushResult,
  RuntimeAuthScopeCacheEntrySummary,
  RuntimeScopedAuthEntry,
  RuntimeScopedState,
} from './precedence.js';

// ─── Device Flows ────────────────────────────────────────────────────────────
export { AnthropicDeviceFlow } from './flows/anthropic-device-flow.js';
export { CodexDeviceFlow, CODEX_CONFIG } from './flows/codex-device-flow.js';
export { QwenDeviceFlow } from './flows/qwen-device-flow.js';
export type { DeviceFlowConfig } from './flows/qwen-device-flow.js';

// ─── Proxy Infrastructure ────────────────────────────────────────────────────
export {
  encodeFrame,
  FrameDecoder,
  FrameError,
  MAX_FRAME_SIZE,
  PARTIAL_FRAME_TIMEOUT_MS,
} from './proxy/framing.js';
export type { FrameDecoderOptions } from './proxy/framing.js';

export {
  ProxySocketClient,
  REQUEST_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  PROTOCOL_VERSION,
} from './proxy/proxy-socket-client.js';
export type { ProxyResponse } from './proxy/proxy-socket-client.js';

export { ProxyTokenStore } from './proxy/proxy-token-store.js';
export { ProxyProviderKeyStorage } from './proxy/proxy-provider-key-storage.js';
