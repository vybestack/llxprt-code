import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  sanitizeForByteString,
  needsSanitization,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import {
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
} from './providerMutations.js';

/**
 * Sanitizes API keys to remove problematic characters that cause ByteString errors.
 * This handles cases where API key files have encoding issues or contain
 * Unicode replacement characters (U+FFFD).
 */
function sanitizeApiKey(key: string): string {
  const sanitized = sanitizeForByteString(key);

  if (needsSanitization(key)) {
    debugLogger.warn(
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
}

/**
 * Sets or removes the API key for the active provider.
 *
 * @plan:PLAN-20250218-STATELESSPROVIDER.P07
 * @requirement:REQ-SP-005
 * @pseudocode:cli-runtime.md lines 9-15
 */
export async function setProviderApiKey(
  apiKey: string | undefined,
  config: { setEphemeralSetting(key: string, value: unknown): void },
  settingsService: Pick<SettingsService, 'get' | 'setProviderSetting'>,
  provider: ReturnType<RuntimeProviderManager['getActiveProvider']>,
): Promise<ProviderConfigResult> {
  try {
    const trimmed = apiKey?.trim();
    const normalized =
      trimmed && trimmed.toLowerCase() !== 'none' && trimmed !== ''
        ? sanitizeApiKey(trimmed)
        : null;
    const result = await updateActiveProviderApiKey(
      normalized,
      config,
      settingsService,
      provider,
    );
    return {
      success: true,
      message: result.message,
      isPaidMode: result.isPaidMode,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to set API key: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Sets or clears the base URL for the active provider.
 *
 * @plan:PLAN-20250218-STATELESSPROVIDER.P07
 * @requirement:REQ-SP-005
 * @pseudocode:cli-runtime.md lines 9-15
 */
export async function setProviderBaseUrl(
  baseUrl: string | undefined,
  config: { setEphemeralSetting(key: string, value: unknown): void },
  settingsService: Pick<SettingsService, 'get' | 'setProviderSetting'>,
): Promise<ProviderConfigResult> {
  try {
    const trimmed = baseUrl?.trim() ?? '';
    const normalized =
      trimmed === '' || trimmed.toLowerCase() === 'none' ? null : trimmed;
    const result = await updateActiveProviderBaseUrl(
      normalized,
      config,
      settingsService,
      (() => {
        const name = settingsService.get('activeProvider');
        return typeof name === 'string' ? name : undefined;
      })(),
    );
    return {
      success: true,
      message: result.message,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to set base URL: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
