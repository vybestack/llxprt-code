/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import type { Config } from '@vybestack/llxprt-code-core';
import {
  ExitCodes,
  JsonFormatter,
  OutputFormat,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { LoadedSettings } from './config/settings.js';

/**
 * Check if any authentication environment variables are set.
 */
function hasAuthEnvVars(): boolean {
  const authKeys = [
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.LLXPRT_API_KEY,
  ];

  return (
    authKeys.some((key) => key !== undefined && key !== '') ||
    process.env.GOOGLE_GENAI_USE_GCA === 'true' ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true'
  );
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

  debugLogger.error(message);
}

/**
 * Validates and initializes authentication for non-interactive mode.
 *
 * #2374 round-3 Fix 2: this function is now a GATE ONLY — it checks whether any
 * auth is configured (provider or env var), applies compression settings, and
 * wires the serverToolsProvider. It does NOT perform authentication. The actual
 * provider activation + auth refresh is delegated to fromConfig's activation
 * intent (constructed in nonInteractiveCli.ts processQuery), which executes
 * executeProviderActivation internally. This keeps the failure semantics
 * identical: at HEAD, the auth refresh threw here → runNonInteractiveSession
 * caught → SessionEnd + report + exit 1. Now fromConfig throws
 * AgentBootstrapError on authFailed → processQuery propagates → runNonInteractive
 * catches → same handler.
 *
 * @param useExternalAuth Retained for the intent construction downstream (read
 *   from settings.merged.useExternalAuth in nonInteractiveCli); NOT used here.
 * @param nonInteractiveConfig The Config instance
 * @param settings Optional settings for compression config
 */
export async function validateNonInteractiveAuth(
  useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
  settings?: LoadedSettings,
) {
  void useExternalAuth; // Gate-only; auth is performed by fromConfig's activation intent (#2374 Fix 2).

  const providerManager = nonInteractiveConfig.getProviderManager();
  const configProvider = nonInteractiveConfig.getProvider();

  // Check if we have any auth configured (provider CLI args or env vars)
  let hasProvider = false;
  if (configProvider !== undefined && providerManager !== undefined) {
    hasProvider = providerManager.hasActiveProvider();
  }
  const hasEnvAuth = hasAuthEnvVars();

  if (!hasProvider && !hasEnvAuth) {
    reportNonInteractiveAuthError(
      nonInteractiveConfig,
      `Please set an Auth method. Use one of the following environment variables: GEMINI_API_KEY, LLXPRT_API_KEY, GOOGLE_GENAI_USE_VERTEXAI (requires GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION), GOOGLE_GENAI_USE_GCA, OPENAI_API_KEY, ANTHROPIC_API_KEY`,
    );
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }

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
  if (providerManager !== undefined) {
    const serverToolsProvider = providerManager.getServerToolsProvider();
    if (
      serverToolsProvider != null &&
      serverToolsProvider.name === 'gemini' &&
      'setConfig' in serverToolsProvider &&
      typeof serverToolsProvider.setConfig === 'function'
    ) {
      serverToolsProvider.setConfig(nonInteractiveConfig);
    }
  }

  return nonInteractiveConfig;
}
