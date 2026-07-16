import {
  type Config,
  writeToStderr,
  triggerSessionEndHook,
  SessionEndReason,
} from '@vybestack/llxprt-code-core';
import {
  debugLogger,
  isTelemetrySdkInitialized,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { type LoadedSettings } from '../config/settings.js';
import { getStartupWarnings } from '../utils/startupWarnings.js';
import { getUserStartupWarnings } from '../utils/userStartupWarnings.js';
import { runNonInteractive } from '../nonInteractiveCli.js';
import type { SessionRecordingSetup } from '../cliSessionBootstrap.js';
import { validateNonInteractiveAuth } from '../validateNonInteractiveAuth.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { initializeOutputListenersAndFlush } from './outputListeners.js';
import { installNonInteractiveSigintHandler } from './signalHandlers.js';
import { reportNonInteractiveError } from './errorReporting.js';
import { startInteractiveUI } from './interactiveUI.js';

/**
 * Report a non-interactive error while swallowing secondary failures so they
 * do not mask the original error or alter the exit code.
 */
function safeReportNonInteractiveError(config: Config, error: unknown): void {
  try {
    reportNonInteractiveError(config, error);
  } catch (reportError) {
    debugLogger.error('Failed to report non-interactive error:', reportError);
  }
}

export interface NonInteractiveSessionOptions {
  config: Config;
  agent: Agent;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
}

export interface PipedOrPromptSessionOptions {
  config: Config;
  agent: Agent;
  settings: LoadedSettings;
  initialInput: string | undefined;
  hasPipedInput: boolean;
  readStdinData: () => Promise<string>;
}

export interface SessionDispatchOptions {
  config: Config;
  /**
   * The single session Agent created at the CLI composition root (#2378). It is
   * threaded into the interactive UI and reused by the non-interactive run; the
   * session MessageBus is read from `agent.getMessageBus()` rather than passed
   * separately. The composition root owns the Agent's lifecycle (dispose on
   * cleanup).
   */
  agent: Agent;
  settings: LoadedSettings;
  workspaceRoot: string;
  recording: SessionRecordingSetup;
  hasPipedInput: boolean;
  readStdinData: () => Promise<string>;
}

/**
 * Collect startup warnings, then dispatch to either the interactive UI or the
 * piped/prompt non-interactive session depending on the configured mode.
 */
export async function dispatchInteractiveOrNonInteractive({
  config,
  agent,
  settings,
  workspaceRoot,
  recording,
  hasPipedInput,
  readStdinData,
}: SessionDispatchOptions): Promise<void> {
  const input = config.getQuestion();

  // The single session bus is owned by the Agent (#2378); consumers read it
  // from the public accessor rather than a separately-threaded instance.
  const sessionMessageBus = agent.getMessageBus();

  // Render UI, passing necessary config values. Check that there is no command line question.
  if (typeof config.isInteractive === 'function' && config.isInteractive()) {
    // Startup warnings are only consumed by the interactive UI, so compute
    // them inside this branch — the non-interactive path avoids the wasted
    // I/O. The two warning sources are independent, so run them in parallel.
    const [systemWarnings, userWarnings] = await Promise.all([
      getStartupWarnings(),
      getUserStartupWarnings(settings.merged),
    ]);
    const startupWarnings = [...systemWarnings, ...userWarnings];

    // The single interactive Agent was created at the composition root and is
    // threaded in here. `fromConfig` fired the SessionStart hook internally
    // during that construction, so the interactive branch does not fire it
    // explicitly (the non-interactive branch keeps its own explicit call for
    // parity with the pre-#2378 behavior).
    await startInteractiveUI(
      config,
      agent,
      settings,
      startupWarnings,
      workspaceRoot,
      sessionMessageBus,
      recording.recordingIntegration,
      recording.resumedHistory ?? undefined,
      recording.recordingService,
      recording.resumedLockHandle,
    );
    return;
  }

  await runPipedOrPromptSession({
    config,
    agent,
    settings,
    initialInput: input,
    hasPipedInput,
    readStdinData,
  });
}

/**
 * Resolve the final non-interactive input (merging piped stdin with any prompt),
 * run the non-interactive session, shut down telemetry, and exit the process.
 */
async function runPipedOrPromptSession({
  config,
  agent,
  settings,
  initialInput,
  hasPipedInput,
  readStdinData,
}: PipedOrPromptSessionOptions): Promise<never> {
  let input = initialInput;
  // If not a TTY, read from stdin
  // This is for cases where the user pipes input directly into the command
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
    writeToStderr(
      `No input provided via stdin. Input can be provided by piping data into llxprt or using the --prompt option.
`,
    );
    await runExitCleanup();
    process.exit(1);
  }

  const prompt_id = Math.random().toString(16).slice(2);

  let nonInteractiveExitCode = 0;
  try {
    nonInteractiveExitCode = await runNonInteractiveSession({
      config,
      agent,
      settings,
      input,
      prompt_id,
    });
  } catch (error) {
    nonInteractiveExitCode = 1;
    debugLogger.error(
      `Non-interactive session setup failed (prompt_id=${prompt_id}):`,
      error,
    );
    safeReportNonInteractiveError(config, error);
  } finally {
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }

    // Call cleanup before process.exit, which causes cleanup to not run
    await runExitCleanup();
  }
  process.exit(nonInteractiveExitCode);
}

/**
 * Drive a single non-interactive run: validate auth, fire session hooks,
 * inject any SessionStart context, run the prompt, and report the exit code.
 */
async function runNonInteractiveSession({
  config,
  agent,
  settings,
  input,
  prompt_id,
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
      runExitCleanup,
    );
  } catch (error) {
    // validateNonInteractiveAuth reports its own auth errors (and calls
    // process.exit), but defensively handle the case where it rejects so the
    // SessionEnd hook and error reporting still run.
    //
    // The original `config` is used here (not a validated config) because the
    // `nonInteractiveConfig` assignment on the line above did not complete —
    // validateNonInteractiveAuth rejected before returning. This may differ
    // from what the run would have used if validateNonInteractiveAuth applied
    // partial mutations before rejecting.
    await triggerSessionEndHook(config, SessionEndReason.Other);
    // Wrap only the reporting call so a secondary reporting failure does not
    // mask the original error or alter the exit code.
    safeReportNonInteractiveError(config, error);
    return 1;
  }

  const removeSigintHandler = installNonInteractiveSigintHandler();
  let nonInteractiveExitCode = 0;
  try {
    initializeOutputListenersAndFlush();

    // Agent owns SessionStart; invoke it once and consume its public output.
    const sessionStartOutput = await agent.hooks.triggerSessionStart();
    let finalInput = input;
    if (sessionStartOutput.systemMessage) {
      writeToStderr(`${sessionStartOutput.systemMessage}
`);
    }
    if (sessionStartOutput.additionalContext) {
      finalInput = `${sessionStartOutput.additionalContext}

${finalInput}`;
    }

    await runNonInteractive({
      config: nonInteractiveConfig,
      // Reuse the composition-root Agent (#2378) instead of building a second
      // one; the session bus is the Agent's own bus.
      agent,
      settings,
      input: finalInput,
      prompt_id,
      runtimeMessageBus: agent.getMessageBus(),
      deferTelemetryShutdown: true,
    });

    // Fire SessionEnd hook on successful completion
    await triggerSessionEndHook(nonInteractiveConfig, SessionEndReason.Exit);
  } catch (error) {
    nonInteractiveExitCode = 1;
    debugLogger.error(
      `Non-interactive run failed (prompt_id=${prompt_id}):`,
      error,
    );
    // Use the SAME config that SessionStart and the run itself use
    // (nonInteractiveConfig) so the SessionEnd hook sees the same runtime
    // context. The auth-validation try/catch above returns 1 on failure, so
    // reaching this point means validateNonInteractiveAuth succeeded and
    // nonInteractiveConfig is assigned — no base-config fallback is needed.
    // triggerSessionEndHook catches hook failures internally (documented
    // non-blocking contract in lifecycleHookTriggers.ts), so no wrapper is
    // needed here — it will never reject or mask the original error.
    await triggerSessionEndHook(nonInteractiveConfig, SessionEndReason.Other);

    // Wrap only the reporting call so a secondary reporting failure does not
    // mask the original error or alter the exit code.
    safeReportNonInteractiveError(nonInteractiveConfig, error);
  } finally {
    removeSigintHandler();
  }
  return nonInteractiveExitCode;
}
