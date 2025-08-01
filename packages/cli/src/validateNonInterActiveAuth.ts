/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, Config } from '@vybestack/llxprt-code-core';
import { USER_SETTINGS_PATH } from './config/settings.js';
import { validateAuthMethod } from './config/auth.js';

function getAuthTypeFromEnv(): AuthType | undefined {
  // In llxprt-code's multi-provider architecture, we always return USE_PROVIDER
  // when any authentication environment variables are set, regardless of the specific type.
  // This allows the provider system to handle the specific authentication method.
  if (
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_GENAI_USE_GCA === 'true' ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
    process.env.GEMINI_API_KEY ||
    process.env.LLXPRT_API_KEY
  ) {
    return AuthType.USE_PROVIDER;
  }
  return undefined;
}

export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
) {
  // Check if a provider is already configured via command line
  const providerManager = nonInteractiveConfig.getProviderManager?.();
  const configProvider = nonInteractiveConfig.getProvider?.();

  if (configProvider && providerManager?.hasActiveProvider?.()) {
    // Provider is configured, but we still need to call refreshAuth to initialize content generator
    await nonInteractiveConfig.refreshAuth(AuthType.USE_PROVIDER);

    // Ensure serverToolsProvider (Gemini) has config set if it's not the active provider
    const serverToolsProvider = providerManager.getServerToolsProvider?.();
    if (
      serverToolsProvider &&
      serverToolsProvider.name === 'gemini' &&
      serverToolsProvider.setConfig
    ) {
      serverToolsProvider.setConfig(nonInteractiveConfig);
    }
    return nonInteractiveConfig;
  }

  const effectiveAuthType = configuredAuthType || getAuthTypeFromEnv();

  if (!effectiveAuthType) {
    console.error(
      `Please set an Auth method in your ${USER_SETTINGS_PATH} or specify one of the following environment variables before running: GEMINI_API_KEY, LLXPRT_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA, OPENAI_API_KEY, ANTHROPIC_API_KEY`,
    );
    process.exit(1);
  }

  if (!useExternalAuth) {
    const err = validateAuthMethod(effectiveAuthType);
    if (err != null) {
      console.error(err);
      process.exit(1);
    }
  }

  await nonInteractiveConfig.refreshAuth(effectiveAuthType);

  // Ensure serverToolsProvider (Gemini) has config set if it's not the active provider
  if (providerManager) {
    const serverToolsProvider = providerManager.getServerToolsProvider?.();
    if (
      serverToolsProvider &&
      serverToolsProvider.name === 'gemini' &&
      serverToolsProvider.setConfig
    ) {
      serverToolsProvider.setConfig(nonInteractiveConfig);
    }
  }

  return nonInteractiveConfig;
}
