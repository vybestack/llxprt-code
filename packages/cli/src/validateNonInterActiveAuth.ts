/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthType,
  Config,
  JsonFormatter,
  OutputFormat,
} from '@vybestack/llxprt-code-core';
import { LoadedSettings } from './config/settings.js';

/**
 * Check if any authentication environment variables are set.
 * SIMPLIFIED (issue #443): Always returns USE_PROVIDER since providers
 * handle their own auth detection via determineBestAuth().
 */
function hasAuthEnvVars(): boolean {
  return !!(
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_GENAI_USE_GCA === 'true' ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
    process.env.GEMINI_API_KEY ||
    process.env.LLXPRT_API_KEY
  );
}

// DEPRECATED (issue #443): Enforced auth type checking removed.
// Providers handle auth detection internally via determineBestAuth().

function reportNonInteractiveAuthError(config: Config, message: string): void {
  const outputFormat =
    typeof config.getOutputFormat === 'function'
      ? config.getOutputFormat()
      : OutputFormat.TEXT;

  if (outputFormat === OutputFormat.JSON) {
    const formatter = new JsonFormatter();
    process.stderr.write(`${formatter.formatError(new Error(message), 1)}\n`);
    return;
  }

  console.error(message);
}

/**
 * Validates and initializes authentication for non-interactive mode.
 * SIMPLIFIED (issue #443): Always uses USE_PROVIDER since providers handle auth internally.
 *
 * @param _configuredAuthType DEPRECATED - ignored, kept for API compat
 * @param _useExternalAuth DEPRECATED - ignored, kept for API compat
 * @param nonInteractiveConfig The Config instance to initialize
 * @param settings Optional settings for compression config
 */
export async function validateNonInteractiveAuth(
  _configuredAuthType: AuthType | undefined, // DEPRECATED (issue #443)
  _useExternalAuth: boolean | undefined, // DEPRECATED (issue #443)
  nonInteractiveConfig: Config,
  settings?: LoadedSettings,
) {
  const providerManager = nonInteractiveConfig.getProviderManager?.();
  const configProvider = nonInteractiveConfig.getProvider?.();

  // Check if we have any auth configured (provider CLI args or env vars)
  const hasProvider = configProvider && providerManager?.hasActiveProvider?.();
  const hasEnvAuth = hasAuthEnvVars();

  if (!hasProvider && !hasEnvAuth) {
    reportNonInteractiveAuthError(
      nonInteractiveConfig,
      `Please set an Auth method. Use one of the following environment variables: GEMINI_API_KEY, LLXPRT_API_KEY, GOOGLE_GENAI_USE_VERTEXAI (requires GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION), GOOGLE_GENAI_USE_GCA, OPENAI_API_KEY, ANTHROPIC_API_KEY`,
    );
    process.exit(1);
  }

  // Always use USE_PROVIDER - providers handle auth detection internally
  await nonInteractiveConfig.refreshAuth(AuthType.USE_PROVIDER);

  // Apply compression settings after authentication
  if (settings) {
    const merged = settings.merged as Record<string, unknown>;
    const contextLimit = merged['context-limit'] as number | undefined;
    const compressionThreshold = merged['compression-threshold'] as
      | number
      | undefined;

    if (compressionThreshold !== undefined) {
      nonInteractiveConfig.setEphemeralSetting(
        'compression-threshold',
        compressionThreshold,
      );
    }
    if (contextLimit !== undefined) {
      nonInteractiveConfig.setEphemeralSetting('context-limit', contextLimit);
    }
  }

  // Ensure serverToolsProvider (Gemini) has config set if it's not the active provider
  if (providerManager) {
    const serverToolsProvider = providerManager.getServerToolsProvider?.();
    if (
      serverToolsProvider &&
      serverToolsProvider.name === 'gemini' &&
      'setConfig' in serverToolsProvider &&
      typeof serverToolsProvider.setConfig === 'function'
    ) {
      serverToolsProvider.setConfig(nonInteractiveConfig);
    }
  }

  return nonInteractiveConfig;
}
