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
import type { LoadedSettings } from './config/settings.js';
import { guardUnconfiguredProvider } from './unconfiguredProviderGuard.js';

/**
 * Gate-only validation for non-interactive mode. Delegates to the
 * unconfigured-provider guard, applies compression settings, and wires the
 * serverToolsProvider. Does NOT perform authentication.
 *
 * When no provider is configured, this delegates to
 * {@link guardUnconfiguredProvider} which reports the error, runs cleanup
 * (when provided), and exits with FATAL_CONFIG_ERROR (52). This avoids
 * inline `process.exit` + error reporting duplication — the guard owns the
 * single centralized exit path.
 *
 * @param useExternalAuth Retained for the intent construction downstream; not
 *   used here.
 * @param nonInteractiveConfig The Config instance.
 * @param settings Optional settings for compression config.
 * @param runCleanup Optional async cleanup function invoked before the
 *   unconfigured-provider exit (defaults to a no-op). When omitted, the guard
 *   is still called with a no-op cleanup so the defensive path still fires.
 */
export async function validateNonInteractiveAuth(
  useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
  settings?: LoadedSettings,
  runCleanup: () => Promise<void> = () => Promise.resolve(),
) {
  void useExternalAuth;

  // Defensive guard: if no provider is configured, delegate to the
  // centralized guard which reports the error and exits 52. The main CLI
  // boundary already calls guardUnconfiguredProvider BEFORE this function,
  // so this is a second line of defense for any caller that bypasses main.
  await guardUnconfiguredProvider(nonInteractiveConfig, runCleanup);

  const providerManager = nonInteractiveConfig.getProviderManager();

  // Apply compression settings after the provider gate
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

  // Ensure serverToolsProvider has config set if it's not the active provider
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
