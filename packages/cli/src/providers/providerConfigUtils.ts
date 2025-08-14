/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ProviderManager,
  Config,
  AuthType,
  sanitizeForByteString,
  needsSanitization,
} from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../config/settings.js';

/**
 * Sanitizes API keys to remove problematic characters that cause ByteString errors.
 * This handles cases where API key files have encoding issues or contain
 * Unicode replacement characters (U+FFFD).
 */
function sanitizeApiKey(key: string): string {
  const sanitized = sanitizeForByteString(key);

  if (needsSanitization(key)) {
    console.warn(
      '[ProviderConfig] API key contained non-ASCII or control characters that were removed. ' +
        'Please check your API key file encoding (should be UTF-8 without BOM).',
    );
  }

  return sanitized;
}

export interface ProviderConfigResult {
  success: boolean;
  message: string;
  isPaidMode?: boolean;
  requiresAuthRefresh?: boolean;
}

/**
 * Sets or removes the API key for the active provider
 */
export async function setProviderApiKey(
  providerManager: ProviderManager,
  settings: LoadedSettings,
  apiKey: string | undefined,
  config?: Config,
): Promise<ProviderConfigResult> {
  try {
    const activeProvider = providerManager.getActiveProvider();
    const providerName = activeProvider.name;

    // If no key provided or 'none', remove the key
    if (
      !apiKey ||
      apiKey.trim() === '' ||
      apiKey.trim().toLowerCase() === 'none'
    ) {
      // Clear the API key
      if (activeProvider.setApiKey) {
        activeProvider.setApiKey('');

        // Don't need to remove from settings as we no longer save API keys there

        // If this is the Gemini provider, we might need to switch auth mode
        const requiresAuthRefresh = providerName === 'gemini' && !!config;
        if (requiresAuthRefresh && config) {
          await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
        }

        // Check payment mode after auth refresh
        const isPaidMode = activeProvider.isPaidMode?.() ?? true;
        const paymentMessage =
          !isPaidMode && providerName === 'gemini'
            ? '\n✅ You are now in FREE MODE - using OAuth authentication'
            : '';

        return {
          success: true,
          message: `API key removed for provider '${providerName}'${paymentMessage}`,
          isPaidMode,
          requiresAuthRefresh,
        };
      } else {
        return {
          success: false,
          message: `Provider '${providerName}' does not support API key updates`,
        };
      }
    }

    // Update the provider's API key (sanitized)
    if (activeProvider.setApiKey) {
      const sanitizedKey = sanitizeApiKey(apiKey);
      activeProvider.setApiKey(sanitizedKey);

      // Don't save API keys to settings - they should only be in profiles or ephemeral

      // If this is the Gemini provider, we need to refresh auth to use API key mode
      const requiresAuthRefresh = providerName === 'gemini' && !!config;
      if (requiresAuthRefresh && config) {
        await config.refreshAuth(AuthType.USE_GEMINI);
      }

      // Check if we're now in paid mode
      const isPaidMode = activeProvider.isPaidMode?.() ?? true;
      const paymentWarning = isPaidMode
        ? '\nWARNING: You are now in PAID MODE - API usage will be charged to your account'
        : '';

      return {
        success: true,
        message: `API key updated for provider '${providerName}'${paymentWarning}`,
        isPaidMode,
        requiresAuthRefresh,
      };
    } else {
      return {
        success: false,
        message: `Provider '${providerName}' does not support API key updates`,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to set API key: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Sets or clears the base URL for the active provider
 */
export async function setProviderBaseUrl(
  providerManager: ProviderManager,
  settings: LoadedSettings,
  baseUrl: string | undefined,
): Promise<ProviderConfigResult> {
  try {
    const activeProvider = providerManager.getActiveProvider();
    const providerName = activeProvider.name;

    if (!baseUrl || baseUrl.trim() === '') {
      // Clear base URL to provider default
      if (activeProvider.setBaseUrl) {
        activeProvider.setBaseUrl(undefined);

        // Don't need to remove from settings as we no longer save base URLs there

        return {
          success: true,
          message: `Base URL cleared, provider '${providerName}' now uses default URL`,
        };
      } else {
        return {
          success: false,
          message: `Provider '${providerName}' does not support base URL updates`,
        };
      }
    }

    // Update the provider's base URL
    if (activeProvider.setBaseUrl) {
      activeProvider.setBaseUrl(baseUrl);

      // Don't save base URLs to settings - they should only be in profiles or ephemeral

      return {
        success: true,
        message: `Base URL updated to '${baseUrl}' for provider '${providerName}'`,
      };
    } else {
      return {
        success: false,
        message: `Provider '${providerName}' does not support base URL updates`,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to set base URL: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
