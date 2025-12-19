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
import { USER_SETTINGS_PATH, LoadedSettings } from './config/settings.js';
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

function getEnforcedAuthTypeFromSettings(
  settings?: LoadedSettings,
): AuthType | undefined {
  const enforcedType = (
    settings?.merged as Record<string, unknown> | undefined
  )?.['security'] as Record<string, unknown> | undefined;
  const enforcedAuth = enforcedType?.['auth'] as
    | Record<string, unknown>
    | undefined;

  const raw = enforcedAuth?.['enforcedType'];
  if (typeof raw !== 'string') {
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const validAuthTypes = new Set<string>(Object.values(AuthType));
  if (!validAuthTypes.has(trimmed)) {
    throw new Error(
      `Invalid security.auth.enforcedType: "${trimmed}". Valid values: ${Array.from(
        validAuthTypes,
      ).join(', ')}`,
    );
  }

  return trimmed as AuthType;
}

function getCurrentGoogleAuthTypeFromEnv(): AuthType | undefined {
  if (process.env.GOOGLE_GENAI_USE_GCA === 'true') {
    return AuthType.LOGIN_WITH_GOOGLE;
  }
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
    return AuthType.USE_VERTEX_AI;
  }
  if (process.env.GEMINI_API_KEY || process.env.LLXPRT_API_KEY) {
    return AuthType.USE_GEMINI;
  }
  return undefined;
}

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

export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
  settings?: LoadedSettings,
) {
  let enforcedAuthType: AuthType | undefined;
  try {
    enforcedAuthType = getEnforcedAuthTypeFromSettings(settings);
  } catch (error) {
    reportNonInteractiveAuthError(
      nonInteractiveConfig,
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
  if (enforcedAuthType) {
    const currentAuthType = getCurrentGoogleAuthTypeFromEnv();
    if (currentAuthType && enforcedAuthType !== currentAuthType) {
      reportNonInteractiveAuthError(
        nonInteractiveConfig,
        `Auth type mismatch: configured auth type is ${enforcedAuthType}, current auth type is ${currentAuthType}.`,
      );
      process.exit(1);
    }
  }

  // Check if a provider is already configured via command line
  const providerManager = nonInteractiveConfig.getProviderManager?.();
  const configProvider = nonInteractiveConfig.getProvider?.();

  if (configProvider && providerManager?.hasActiveProvider?.()) {
    // Provider is configured, but we still need to call refreshAuth to initialize content generator
    await nonInteractiveConfig.refreshAuth(AuthType.USE_PROVIDER);

    // Apply compression settings after authentication
    if (settings) {
      const merged = settings.merged as Record<string, unknown>;
      const contextLimit = merged['context-limit'] as number | undefined;
      const compressionThreshold = merged['compression-threshold'] as
        | number
        | undefined;

      // Set compression settings via ephemeral settings
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
    const serverToolsProvider = providerManager.getServerToolsProvider?.();
    if (
      serverToolsProvider &&
      serverToolsProvider.name === 'gemini' &&
      'setConfig' in serverToolsProvider &&
      typeof serverToolsProvider.setConfig === 'function'
    ) {
      serverToolsProvider.setConfig(nonInteractiveConfig);
    }
    return nonInteractiveConfig;
  }

  const effectiveAuthType = configuredAuthType || getAuthTypeFromEnv();

  if (!effectiveAuthType) {
    reportNonInteractiveAuthError(
      nonInteractiveConfig,
      `Please set an Auth method in your ${USER_SETTINGS_PATH} or specify one of the following environment variables before running: GEMINI_API_KEY, LLXPRT_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA, OPENAI_API_KEY, ANTHROPIC_API_KEY`,
    );
    process.exit(1);
  }

  if (!useExternalAuth) {
    const err = validateAuthMethod(effectiveAuthType);
    if (err != null) {
      reportNonInteractiveAuthError(nonInteractiveConfig, err);
      process.exit(1);
    }
  }

  await nonInteractiveConfig.refreshAuth(effectiveAuthType);

  // Compression settings are already set via ephemeral settings
  // geminiChat.ts will read them directly when needed

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
