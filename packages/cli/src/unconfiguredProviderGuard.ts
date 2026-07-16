/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  ExitCodes,
  OutputFormat,
  JsonFormatter,
  StreamJsonFormatter,
  JsonStreamEventType,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

export const UNCONFIGURED_PROVIDER_MESSAGE =
  'No provider is configured. ' +
  'Use --provider <name> (e.g. gemini, openai, anthropic, ollama) to select a hosted provider. ' +
  'Use --profile-load <name> to load a saved profile. ' +
  'Set the LLXPRT_DEFAULT_PROVIDER environment variable to choose a default. ' +
  'Or run /setup interactively to configure a hosted provider, a local model, a custom compatible endpoint, or select an existing profile.';

/**
 * Pure read: returns true when a provider is actively configured on the
 * provider manager (the single source of truth for active-provider state).
 * Does NOT call process.exit, mutate state, or consult bare API-key env vars.
 */
export function isProviderConfigured(config: Config): boolean {
  const manager = config.getProviderManager();
  return manager?.hasActiveProvider() ?? false;
}

/**
 * Reports the unconfigured-provider error using the appropriate output format
 * (TEXT, JSON, or STREAM_JSON). This is the single centralized reporting path
 * for the unconfigured-provider guard — callers must use this instead of
 * plain `debugLogger.error` so structured modes (JSON / STREAM_JSON) receive
 * properly formatted output.
 *
 * Emits the message exactly once via stderr. Does NOT also write to
 * debugLogger to avoid double-emission in structured output modes.
 */
export function reportUnconfiguredProviderError(
  config: Pick<Config, 'getOutputFormat'>,
): void {
  const outputFormat =
    typeof config.getOutputFormat === 'function'
      ? config.getOutputFormat()
      : OutputFormat.TEXT;

  if (outputFormat === OutputFormat.JSON) {
    const formatter = new JsonFormatter();
    process.stderr.write(
      formatter.formatError(new Error(UNCONFIGURED_PROVIDER_MESSAGE)) + '\n',
    );
  } else if (outputFormat === OutputFormat.STREAM_JSON) {
    const streamFormatter = new StreamJsonFormatter();
    process.stderr.write(
      streamFormatter.formatEvent({
        type: JsonStreamEventType.ERROR,
        timestamp: new Date().toISOString(),
        severity: 'error',
        message: UNCONFIGURED_PROVIDER_MESSAGE,
      }),
    );
  } else {
    process.stderr.write(UNCONFIGURED_PROVIDER_MESSAGE + '\n');
  }
}

/**
 * Gate the non-interactive path when no provider is configured.
 *
 * When `config.isInteractive()` is false (non-interactive / piped mode) and
 * the provider manager has no active provider, this reports the actionable
 * shared {@link UNCONFIGURED_PROVIDER_MESSAGE}, runs cleanup, and exits with
 * {@link ExitCodes.FATAL_CONFIG_ERROR} (52).
 *
 * @param config The Config instance.
 * @param runCleanup Async cleanup function to run before exit (e.g.
 *   `runExitCleanup`). Called only on the exit path. Even if cleanup throws,
 *   the process still exits with code 52 (via try/finally).
 * @returns Resolves when the caller may proceed (provider configured or
 *   interactive mode). When unconfigured in non-interactive mode the function
 *   does not resolve — it exits the process.
 */
export async function guardUnconfiguredProvider(
  config: Config,
  runCleanup: () => Promise<void>,
): Promise<void> {
  if (isProviderConfigured(config)) {
    return;
  }
  if (typeof config.isInteractive === 'function' && config.isInteractive()) {
    return;
  }
  reportUnconfiguredProviderError(config);
  try {
    await runCleanup();
  } catch (cleanupError) {
    debugLogger.error(
      'Cleanup failed during unconfigured-provider exit:',
      cleanupError instanceof Error
        ? cleanupError
        : new Error(String(cleanupError)),
    );
  } finally {
    process.exit(ExitCodes.FATAL_CONFIG_ERROR);
  }
}
