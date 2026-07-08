/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type OAuthManager } from '@vybestack/llxprt-code-auth';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

export type GeminiAuthMode = 'oauth' | 'gemini-api-key' | 'vertex-ai' | 'none';

export interface VertexAIAuthConfig {
  project?: string;
  location?: string;
}

function getNonEmptySetting(
  settingsService: SettingsService | undefined,
  key: string,
): string | undefined {
  const value = settingsService?.get(key);
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getSettingOrEnv(
  settingsService: SettingsService | undefined,
  key: string,
): string | undefined {
  const settingValue = getNonEmptySetting(settingsService, key);
  if (settingValue !== undefined) {
    return settingValue;
  }
  const envValue = process.env[key]?.trim();
  return envValue && envValue.length > 0 ? envValue : undefined;
}

export function getVertexAIAuthConfig(
  settingsService?: SettingsService,
): VertexAIAuthConfig {
  return {
    project: getSettingOrEnv(settingsService, 'GOOGLE_CLOUD_PROJECT'),
    location: getSettingOrEnv(settingsService, 'GOOGLE_CLOUD_LOCATION'),
  };
}

/**
 * Checks if Vertex AI credentials are available via runtime settings or
 * environment variables.
 *
 * The `no-restricted-syntax` rule is intentionally not suppressed here:
 * environment-variable existence checks are the intended pattern at this
 * auth boundary. Callers must keep the eslint config allowing these reads
 * (see eslint.config.js completedDirectiveCleanupScopes / legacy overrides).
 */
export function hasVertexAICredentials(
  settingsService?: SettingsService,
): boolean {
  const vertexConfig = getVertexAIAuthConfig(settingsService);
  const hasProjectAndLocation =
    !!vertexConfig.project && !!vertexConfig.location;
  const hasGoogleApiKey = !!getSettingOrEnv(settingsService, 'GOOGLE_API_KEY');
  const hasApplicationCredentials = !!getSettingOrEnv(
    settingsService,
    'GOOGLE_APPLICATION_CREDENTIALS',
  );
  return hasProjectAndLocation || hasGoogleApiKey || hasApplicationCredentials;
}

/** Set up the environment variable for Vertex AI authentication. */
export function setupVertexAIAuth(): void {
  process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
}

/**
 * Check whether OAuth is enabled for the given provider name in the
 * (optional) OAuth manager. Returns false when no manager is configured.
 */
export function isOAuthEnabled(
  oauthManager: OAuthManager | undefined,
  providerName: string,
): boolean {
  const manager = oauthManager as
    | (OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      })
    | undefined;
  if (manager?.isOAuthEnabled && typeof manager.isOAuthEnabled === 'function') {
    return manager.isOAuthEnabled(providerName);
  }
  return false;
}

/**
 * Update the OAuth configuration on a provider-like object based on the
 * current OAuth manager state.
 */
export function updateOAuthState(
  oauthManager: OAuthManager | undefined,
  updateOAuthConfig: (
    enabled: boolean,
    provider: string,
    manager: OAuthManager,
  ) => void,
): void {
  if (oauthManager) {
    updateOAuthConfig(
      isOAuthEnabled(oauthManager, 'gemini'),
      'gemini',
      oauthManager,
    );
  }
}
