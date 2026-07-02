/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  debugLogger,
  isTelemetrySdkInitialized,
  shutdownTelemetry,
  writeToStderr,
  OutputFormat,
  triggerSessionStartHook,
  triggerSessionEndHook,
  SessionStartSource,
  SessionEndReason,
  type MessageBus,
} from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from './config/settings.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { validateNonInteractiveAuth } from './validateNonInteractiveAuth.js';
import { runExitCleanup } from './utils/cleanup.js';
import {
  formatNonInteractiveError,
  initializeOutputListenersAndFlush,
  installNonInteractiveSigintHandler,
  reportJsonError,
} from './cliProcessUtils.js';

export interface PipedOrPromptSessionOptions {
  readonly config: Config;
  readonly settings: LoadedSettings;
  readonly sessionMessageBus?: MessageBus;
  readonly initialInput: string | undefined;
  readonly hasPipedInput: boolean;
  readonly readStdinData: () => Promise<string>;
}

interface NonInteractiveSessionOptions {
  readonly config: Config;
  readonly settings: LoadedSettings;
  readonly input: string;
  readonly prompt_id: string;
  readonly sessionMessageBus?: MessageBus;
}

/**
 * Resolve the final non-interactive input (merging piped stdin with any prompt),
 * run the non-interactive session, shut down telemetry, and exit the process.
 */
export async function runPipedOrPromptSession({
  config,
  settings,
  sessionMessageBus,
  initialInput,
  hasPipedInput,
  readStdinData,
}: PipedOrPromptSessionOptions): Promise<never> {
  let input = initialInput;
  // If not a TTY, read from stdin. This is for cases where the user pipes input
  // directly into the command.
  if (hasPipedInput) {
    const stdinData = await readStdinData();
    if (stdinData) {
      const existingInput = input ?? '';
      // Preserve the stdin+prompt separator only when a prompt exists;
      // otherwise stdin data alone is the input (no trailing newlines).
      input = existingInput
        ? `${stdinData}

${existingInput}`
        : stdinData;
    }
  }
  if (!input) {
    await new Promise<void>((resolve) => {
      process.stderr.write(
        `No input provided via stdin. Input can be provided by piping data into llxprt or using the --prompt option.
`,
        () => resolve(),
      );
    });
    await shutdownTelemetryAndCleanup(config);
    process.exit(1);
  }

  const prompt_id = Math.random().toString(16).slice(2);

  const nonInteractiveExitCode = await runNonInteractiveSession({
    config,
    settings,
    input,
    prompt_id,
    sessionMessageBus,
  });

  await shutdownTelemetryAndCleanup(config);
  process.exit(nonInteractiveExitCode);
}

async function shutdownTelemetryAndCleanup(config: Config): Promise<void> {
  if (isTelemetrySdkInitialized()) {
    // Telemetry shutdown must never prevent exit cleanup from running.
    try {
      await shutdownTelemetry(config);
    } catch (error) {
      writeToStderr(`Telemetry shutdown failed: ${error}
`);
    }
  }

  // Call cleanup before process.exit, which causes cleanup to not run.
  await runExitCleanup();
}

/**
 * Drive a single non-interactive run: validate auth, fire session hooks, inject
 * any SessionStart context, run the prompt, and report the exit code.
 */
async function runNonInteractiveSession({
  config,
  settings,
  input,
  prompt_id,
  sessionMessageBus,
}: NonInteractiveSessionOptions): Promise<number> {
  // Validate auth BEFORE installing the SIGINT handler: on auth failure
  // validateNonInteractiveAuth calls process.exit, which bypasses the finally
  // below (where the disposer would run). By validating first, the SIGINT
  // handler is only on the process during the run phase that needs it, so an
  // auth-failure process.exit cannot leak it.
  let nonInteractiveConfig: Config | undefined;
  try {
    nonInteractiveConfig = await validateNonInteractiveAuth(
      settings.merged.useExternalAuth,
      config,
      settings,
    );
  } catch (error) {
    // validateNonInteractiveAuth reports its own auth errors (and calls
    // process.exit), but defensively handle the case where it rejects so the
    // SessionEnd hook and error reporting still run.
    await triggerSessionEndHook(config, SessionEndReason.Other);
    safelyReportNonInteractiveError(config, error);
    return 1;
  }

  const validatedConfig: Config = nonInteractiveConfig;
  const removeSigintHandler = installNonInteractiveSigintHandler(async () => {
    await triggerSessionEndHook(validatedConfig, SessionEndReason.Other);
    await shutdownTelemetryAndCleanup(validatedConfig);
  });
  let nonInteractiveExitCode = 0;
  try {
    initializeOutputListenersAndFlush();

    // Fire SessionStart hook for non-interactive mode and inject context.
    const sessionStartOutput = await triggerSessionStartHook(
      nonInteractiveConfig,
      SessionStartSource.Startup,
    );
    let finalInput = input;
    if (sessionStartOutput) {
      if (sessionStartOutput.systemMessage) {
        writeToStderr(`${sessionStartOutput.systemMessage}
`);
      }
      const additionalContext = sessionStartOutput.getAdditionalContext();
      if (additionalContext) {
        finalInput = `${additionalContext}

${finalInput}`;
      }
    }

    await runNonInteractive({
      config: nonInteractiveConfig,
      settings,
      input: finalInput,
      prompt_id,
      runtimeMessageBus: sessionMessageBus,
      deferTelemetryShutdown: true,
    });

    // Fire SessionEnd hook on successful completion.
    await triggerSessionEndHook(nonInteractiveConfig, SessionEndReason.Exit);
  } catch (error) {
    nonInteractiveExitCode = 1;
    // Use the SAME config that SessionStart and the run itself use
    // (nonInteractiveConfig) so the SessionEnd hook sees the same runtime
    // context. The auth-validation try/catch above returns 1 on failure, so
    // reaching this point means validateNonInteractiveAuth succeeded and
    // nonInteractiveConfig is assigned — no base-config fallback is needed.
    // triggerSessionEndHook catches hook failures internally (documented
    // non-blocking contract in lifecycleHookTriggers.ts), so no wrapper is
    // needed here — it will never reject or mask the original error.
    await triggerSessionEndHook(nonInteractiveConfig, SessionEndReason.Other);

    safelyReportNonInteractiveError(nonInteractiveConfig, error);
  } finally {
    removeSigintHandler();
  }
  return nonInteractiveExitCode;
}

/**
 * Format and report a non-interactive error to the appropriate output stream
 * (JSON formatter when JSON output is configured, otherwise the debug logger).
 */
function safelyReportNonInteractiveError(config: Config, error: unknown): void {
  try {
    reportNonInteractiveError(config, error);
  } catch (reportError) {
    debugLogger.error(
      `Failed to report non-interactive error: ${formatNonInteractiveError(reportError)}`,
    );
    debugLogger.error(
      `Original non-interactive error: ${formatNonInteractiveError(error)}`,
    );
  }
}

function reportNonInteractiveError(config: Config, error: unknown): void {
  if (config.getOutputFormat() === OutputFormat.JSON) {
    reportJsonError(error);
  } else {
    const printableError = formatNonInteractiveError(error);
    writeToStderr(`${printableError}
`);
    debugLogger.error(`Non-interactive run failed: ${printableError}`);
  }
}
