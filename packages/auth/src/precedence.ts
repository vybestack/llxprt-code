/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication precedence utility for providers
 *
 * Implements the authentication precedence chain:
 * 1. Provider-specific auth-key/keyfile (from getProviderSettings)
 * 2. Constructor API key
 * 3. Global auth-key/keyfile (from settings when activeProvider matches)
 * 4. Environment variables
 * 5. OAuth (if enabled)
 *
 * @plan PLAN-20260608-ISSUE1586.P09
 * @requirement REQ-AUTH-001.1, REQ-API-001.4
 */

import type { ISettingsService } from './interfaces/settings-service.js';

export interface ResolveAuthOptions {
  settingsService?: ISettingsService | null;
  includeOAuth?: boolean;
  runtimeId?: string;
  profileId?: string;
  authIntent?: 'oauth' | 'apikey';
}

export interface AuthPrecedenceConfig {
  // Constructor/direct API key
  apiKey?: string;

  // Environment variable names to check
  envKeyNames?: string[];

  // OAuth configuration
  isOAuthEnabled?: boolean;
  supportsOAuth?: boolean;
  oauthProvider?: string;
  providerId?: string;
}

import { type OAuthToken } from './types.js';

export interface OAuthTokenRequestMetadata {
  runtimeAuthScopeId?: string;
  providerId?: string;
  profileId?: string;
  cliScope?: Record<string, unknown>;
  runtimeMetadata?: Record<string, unknown>;
}

export interface OAuthManager {
  getToken(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<string | null>;
  isAuthenticated(provider: string): Promise<boolean>;
  getOAuthToken?(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<OAuthToken | null>;
  /**
   * Force refresh a token when it is known to be revoked.
   * @fix issue1861 - Token revocation handling
   */
  forceRefreshToken?(
    provider: string,
    failedAccessToken: string,
  ): Promise<OAuthToken | null>;
}

export function resolveProfileId(
  settingsService: ISettingsService,
): string | null {
  const maybeGetName = (
    settingsService as {
      getCurrentProfileName?: () => string | null;
    }
  ).getCurrentProfileName;
  if (typeof maybeGetName === 'function') {
    const profileName = maybeGetName.call(settingsService);
    if (profileName?.trim()) {
      return profileName.trim();
    }
  }
  const currentProfile = settingsService.get('currentProfile');
  if (typeof currentProfile === 'string' && currentProfile.trim()) {
    return currentProfile.trim();
  }
  return null;
}

export { AuthPrecedenceResolver } from './auth-precedence-resolver.js';
