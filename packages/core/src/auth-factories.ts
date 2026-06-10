/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260608-ISSUE1586.P17
 * @requirement:REQ-AUTH-001.4
 *
 * Core DI factory functions for creating fully-configured auth instances.
 * These factories inject core implementations (SecureStore, DebugLogger,
 * ProviderKeyStorage) into auth-package constructors, so consumers don't
 * need to know about DI wiring details.
 *
 * Per C-CB-09:
 * - createKeyringTokenStore: injects core SecureStore + DebugLogger
 * - createAuthPrecedenceResolver: injects core ProviderKeyStorage + DebugLogger;
 *   forwards caller-supplied oauthManager and getActiveRuntimeContext
 * - SecureStore/getSecureStore is NOT used in AuthPrecedenceResolver —
 *   it belongs exclusively to the KeyringTokenStore path
 */

import {
  KeyringTokenStore,
  AuthPrecedenceResolver,
} from '@vybestack/llxprt-code-auth';
import type {
  AuthPrecedenceConfig,
  OAuthManager,
  ISettingsService as AuthISettingsService,
  IProviderRuntimeContext,
} from '@vybestack/llxprt-code-auth';
import { SecureStore } from './storage/secure-store.js';
import { getProviderKeyStorage } from './storage/provider-key-storage.js';
import { DebugLogger } from './debug/DebugLogger.js';

/** Service name for the OAuth token SecureStore instance. */
const AUTH_SECURE_STORE_SERVICE = 'llxprt-code-oauth';

/**
 * Creates a fully-configured KeyringTokenStore with core SecureStore
 * and DebugLogger injected.
 *
 * The returned KeyringTokenStore can immediately save/load tokens
 * using the OS keychain via core's SecureStore implementation.
 */
export function createKeyringTokenStore(): KeyringTokenStore {
  const secureStore = new SecureStore(AUTH_SECURE_STORE_SERVICE, {
    // Preserve existing OAuth behavior: SecureStore fallback files are encrypted
    // at rest, and Linux keeps an encrypted fallback after successful keyring writes.
    fallbackPolicy: 'allow',
  });
  const logger = new DebugLogger('llxprt:auth:keyring');
  return new KeyringTokenStore({ secureStore, logger });
}

/**
 * Creates a fully-configured AuthPrecedenceResolver with core
 * ProviderKeyStorage and DebugLogger injected.
 *
 * @param config - Auth precedence configuration (API key, env vars, OAuth flags)
 * @param settingsService - Core SettingsService satisfying ISettingsService
 * @param oauthManager - Optional OAuthManager instance (caller-supplied, forwarded)
 * @param getActiveRuntimeContext - Optional runtime context getter (caller-supplied, forwarded)
 */
export function createAuthPrecedenceResolver(
  config: AuthPrecedenceConfig,
  settingsService: AuthISettingsService,
  oauthManager?: OAuthManager,
  getActiveRuntimeContext?: () => IProviderRuntimeContext | null,
): AuthPrecedenceResolver {
  const providerKeyStorage = getProviderKeyStorage();
  const logger = new DebugLogger('llxprt:auth:precedence');
  return new AuthPrecedenceResolver(config, {
    oauthManager,
    settingsService,
    providerKeyStorage,
    logger,
    getActiveRuntimeContext,
  });
}
