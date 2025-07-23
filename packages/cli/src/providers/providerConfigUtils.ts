/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { ProviderManager, Config, AuthType } from '@vybestack/llxprt-code-core';
import { LoadedSettings, SettingScope } from '../config/settings.js';

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

    // Update the provider's API key
    if (activeProvider.setApiKey) {
      activeProvider.setApiKey(apiKey);

      // Save to settings
      const currentKeys = settings.merged.providerApiKeys || {};
      currentKeys[providerName] = apiKey;
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
    const apiKey = (await readFile(resolvedPath, 'utf-8')).trim();

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
