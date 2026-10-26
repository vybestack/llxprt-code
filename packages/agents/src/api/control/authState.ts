/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 *
 * Per-agent mutable AUTH-STATE holder. Owned by AgentImpl (parallel to
 * AgentProviderState). Carries every auth-related field the public auth/keys
 * controls mutate and that computeAuthStatus/getProviderStatus read, EXCEPT
 * the keyName reference — that lives on providerState.keyName as the single
 * source of truth so profiles.apply (setKeyName) and auth.keys.use stay
 * consistent. The secret value lives ONLY in the in-memory keyStore map and is
 * NEVER copied onto providerState or into any ProviderStatus/ProfileDetail.
 *
 * Hermeticity: the real ProviderKeyStorage persists to the HOST keychain /
 * the LLxprt data directory (provider-keys) unless LLXPRT_CREDENTIAL_SOCKET
 * is set. The agents tests do NOT mock it and do NOT set that env. Writing
 * real secrets there would POLLUTE the developer's host machine. The keyStore
 * here is a per-agent in-memory Map — it dies with the agent and never
 * touches disk.
 */

import type { AuthBucket } from '../agent.js';
import type { AgentAuth } from '../config-types.js';

/**
 * The REQ-008 precedence winner. Determines which auth source surfaces in
 * getProviderStatus(). Highest → lowest precedence.
 *
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export type AuthWinner =
  | 'raw'
  | 'keyName'
  | 'inline'
  | 'keyfile'
  | 'oauth'
  | 'none';

/**
 * Per-agent mutable auth state. Seeded at AgentImpl construction from the
 * threaded initial auth config (config.auth).
 *
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export interface AgentAuthState {
  /** setRaw(value)→true; setRaw(null)→false; seeded false. */
  rawKeyPresent: boolean;
  /** Seeded from config.auth.apiKey !== undefined. */
  inlineKeyPresent: boolean;
  /** Seeded from config.auth.apiKeyFile. */
  keyFile: string | undefined;
  /** Seeded from config.auth.baseUrl. */
  baseUrl: string | undefined;
  /** Providers with OAuth enabled (enableOAuth adds). */
  oauthEnabled: Set<string>;
  /** Providers authenticated via an accepted onOAuthPrompt. */
  oauthAuthenticated: Set<string>;
  /** IN-MEMORY named secrets (save/delete). NEVER surfaced onto status. */
  keyStore: Map<string, string>;
  /** MCP servers authenticated via mcpLogin. */
  mcpAuth: Set<string>;
  /** Per-provider session buckets (for synchronous listBuckets). */
  buckets: Map<string, AuthBucket[]>;
}

/**
 * Creates a fresh, empty AgentAuthState.
 *
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export function createAgentAuthState(): AgentAuthState {
  return {
    rawKeyPresent: false,
    inlineKeyPresent: false,
    keyFile: undefined,
    baseUrl: undefined,
    oauthEnabled: new Set<string>(),
    oauthAuthenticated: new Set<string>(),
    keyStore: new Map<string, string>(),
    mcpAuth: new Set<string>(),
    buckets: new Map<string, AuthBucket[]>(),
  };
}

/**
 * Seeds the per-agent auth state from the threaded initial auth config.
 * inlineKeyPresent from auth.apiKey, keyFile from auth.apiKeyFile, baseUrl
 * from auth.baseUrl, oauthEnabled add(provider) if auth.oauth, keyName seed
 * onto providerState.keyName from auth.keyName. The secret value is NEVER
 * stored on authState or providerState.
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export function seedAgentAuthState(
  authState: AgentAuthState,
  providerState: { keyName?: string },
  initialAuth: AgentAuth | undefined,
  provider: string,
): void {
  if (initialAuth === undefined) {
    return;
  }
  authState.inlineKeyPresent = initialAuth.apiKey !== undefined;
  authState.keyFile = initialAuth.apiKeyFile;
  authState.baseUrl = initialAuth.baseUrl;
  if (initialAuth.oauth === true) {
    authState.oauthEnabled.add(provider);
  }
  if (initialAuth.keyName !== undefined) {
    providerState.keyName = initialAuth.keyName;
  }
}

/**
 * Computes the REQ-008 precedence winner for a provider given the auth state
 * and the current keyName reference (read from providerState).
 *
 * Precedence (highest→lowest):
 *   raw > keyName > inline > keyfile > oauth > none
 *
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export function computeAuthWinner(
  state: AgentAuthState,
  keyName: string | undefined,
  provider: string,
): AuthWinner {
  if (state.rawKeyPresent) {
    return 'raw';
  }
  if (keyName !== undefined) {
    return 'keyName';
  }
  if (state.inlineKeyPresent) {
    return 'inline';
  }
  if (state.keyFile !== undefined) {
    return 'keyfile';
  }
  if (state.oauthAuthenticated.has(provider)) {
    return 'oauth';
  }
  return 'none';
}
