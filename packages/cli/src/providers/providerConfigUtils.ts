/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  ProviderManager,
  Config,
  AuthType,
  sanitizeForByteString,
  needsSanitization,
} from '@vybestack/llxprt-code-core';
import { LoadedSettings, SettingScope } from '../config/settings.js';

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

        // Remove from settings
        const currentKeys = settings.merged.providerApiKeys || {};
        delete currentKeys[providerName];
        settings.setValue(SettingScope.User, 'providerApiKeys', currentKeys);

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

      // Save to settings (sanitized)
      const currentKeys = settings.merged.providerApiKeys || {};
      currentKeys[providerName] = sanitizedKey;
      settings.setValue(SettingScope.User, 'providerApiKeys', currentKeys);

      // If this is the Gemini provider, we need to refresh auth to use API key mode
      const requiresAuthRefresh = providerName === 'gemini' && !!config;
      if (requiresAuthRefresh && config) {
        await config.refreshAuth(AuthType.USE_GEMINI);
      }

      // Check if we're now in paid mode
      const isPaidMode = activeProvider.isPaidMode?.() ?? true;
      const paymentWarning = isPaidMode
        ? '\n⚠️  You are now in PAID MODE - API usage will be charged to your account'
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
 * Sets the API key from a file for the active provider
 */
export async function setProviderApiKeyFromFile(
  providerManager: ProviderManager,
  settings: LoadedSettings,
  filePath: string,
  config?: Config,
): Promise<ProviderConfigResult> {
  try {
    // Resolve ~ to home directory
    const resolvedPath = filePath.replace(/^~/, homedir());

    // Read the API key from file
    const buffer = await readFile(resolvedPath);

    // Detect encoding and convert to string
    let fileContent: string;

    // Check for UTF-16 LE BOM (FF FE)
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      fileContent = buffer.toString('utf16le').slice(1); // Remove BOM
    }
    // Check for UTF-16 BE BOM (FE FF)
    else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      // UTF-16 BE is less common on Windows but handle it
      fileContent = buffer.swap16().toString('utf16le').slice(1);
    }
    // Check for UTF-8 BOM (EF BB BF)
    else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      fileContent = buffer.toString('utf-8').slice(1); // Remove BOM
    }
    // Check if content appears to be UTF-16 LE without BOM (common on Windows)
    // Look for null bytes between ASCII characters
    else if (buffer.length > 3 && buffer[1] === 0x00 && buffer[3] === 0x00) {
      fileContent = buffer.toString('utf16le');
    }
    // Default to UTF-8
    else {
      fileContent = buffer.toString('utf-8');
    }

    // Clean up any remaining encoding artifacts
    // Remove null bytes that might remain
    fileContent = fileContent.replace(/\0/g, '');

    // Remove any Unicode replacement characters
    fileContent = fileContent.replace(/\uFFFD/g, '');

    // Remove all types of whitespace and newlines, then trim
    const apiKey = fileContent.trim();

    if (!apiKey) {
      return {
        success: false,
        message: 'The specified file is empty',
      };
    }

    // Use the setProviderApiKey function to handle the actual key setting
    const result = await setProviderApiKey(
      providerManager,
      settings,
      apiKey,
      config,
    );

    // Modify the message to indicate it was loaded from a file
    if (result.success && result.message.includes('API key updated')) {
      result.message = result.message.replace(
        'API key updated',
        `API key loaded from ${resolvedPath}`,
      );
    }

    return result;
  } catch (error) {
    return {
      success: false,
      message: `Failed to process keyfile: ${error instanceof Error ? error.message : String(error)}`,
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

        // Remove from settings
        const currentUrls = settings.merged.providerBaseUrls || {};
        delete currentUrls[providerName];
        settings.setValue(SettingScope.User, 'providerBaseUrls', currentUrls);

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

      // Save to settings
      const currentUrls = settings.merged.providerBaseUrls || {};
      currentUrls[providerName] = baseUrl;
      settings.setValue(SettingScope.User, 'providerBaseUrls', currentUrls);

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
