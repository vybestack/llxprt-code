/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260629-ISSUE2204
 * @requirement:REQ-2204-1
 *
 * TEMPORARY session-dispatch / interactive-UI-render quarantine module.
 *
 * Session-dispatch and interactive-UI render helpers extracted from cli.tsx
 * (issue #2204 thin-entry work). main() in cli.tsx is now an ordered sequence
 * of delegated calls; the interactive-vs-non-interactive dispatch, the ink
 * render, and the piped/prompt session driving live here.
 *
 * This module is an INTENTIONAL TEMPORARY QUARANTINE: it is the holding pen
 * for session-orchestration logic lifted out of the once-monolithic cli.tsx
 * entrypoint so cli.tsx could shrink to a thin entry (shebang + top-level
 * error handling + main() invocation). It is NOT a long-term home for this
 * logic. As the thin-entry extraction matures (#1595), the dispatch/render
 * responsibilities here are expected to migrate closer to the runtime
 * composition root (the CLI's one legitimate wiring site) or dissolve into
 * the public Agent surface, at which point this module should shrink or be
 * removed. Until then, every new helper added here is technical debt on the
 * quarantine boundary and must be justified.
 */

import React, { type ErrorInfo } from 'react';
import { render } from 'ink';
import { AppWrapper } from './ui/App.js';
import { ErrorBoundary } from './ui/components/ErrorBoundary.js';
import { basename } from 'node:path';
import { type LoadedSettings } from './config/settings.js';
import {
  type Config,
  parseAndFormatApiError,
  type SessionRecordingService,
  type RecordingIntegration,
  type IContent,
  type LockHandle,
  type MessageBus,
  debugLogger,
  isTelemetrySdkInitialized,
  shutdownTelemetry,
  writeToStderr,
  writeToStdout,
  OutputFormat,
  JsonFormatter,
  coreEvents,
  CoreEvent,
  type OutputPayload,
  type ConsoleLogPayload,
  triggerSessionStartHook,
  triggerSessionEndHook,
  SessionStartSource,
  SessionEndReason,
} from '@vybestack/llxprt-code-core';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { getCliVersion } from './utils/version.js';
import { disableMouseEvents, enableMouseEvents } from './ui/utils/mouse.js';
import { restoreTerminalProtocolsSync } from './ui/utils/terminalProtocolCleanup.js';
import {
  DISABLE_BRACKETED_PASTE,
  DISABLE_FOCUS_TRACKING,
  SHOW_CURSOR,
} from './ui/utils/terminalSequences.js';
import { checkForUpdates } from './ui/utils/updateCheck.js';
import { handleAutoUpdate } from './utils/handleAutoUpdate.js';
import { appEvents, AppEvent } from './utils/events.js';
import { SettingsContext } from './ui/contexts/SettingsContext.js';
import { inkRenderOptions } from './ui/inkRenderOptions.js';
import { isMouseEventsEnabled } from './ui/mouseEventsEnabled.js';
import { computeTerminalTitle } from './utils/windowTitle.js';
import { StreamingState } from './ui/types.js';
import { appendFileSync } from 'fs';
import { join } from 'path';
import type { SessionRecordingSetup } from './cliSessionBootstrap.js';
import { createForegroundAgent } from './cliAgentBootstrap.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { validateNonInteractiveAuth } from './validateNonInteractiveAuth.js';
import {
  registerCleanup,
  registerSyncCleanup,
  runExitCleanup,
} from './utils/cleanup.js';

export function formatNonInteractiveError(error: unknown): string {
  const formatted = parseAndFormatApiError(error);
  if (formatted && !formatted.includes('[object Object]')) {
    return formatted;
  }

  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (error !== null && typeof error === 'object') {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

export function installNonInteractiveSigintHandler(): () => void {
  let exited = false;
  const handler = () => {
    if (exited) {
      return;
    }
    exited = true;
    process.stderr.write('\nCancelled.\n');
    process.exit(130);
  };
  process.on('SIGINT', handler);
  return () => {
    process.off('SIGINT', handler);
  };
}

/**
 * Installs a process-wide `unhandledRejection` listener that logs the error
 * and opens the debug console on the first rejection.
 *
 * Returns a disposer that removes the installed listener. The listener is a
 * process-lifetime singleton: `setupProcessLifecycle` installs it once per CLI
 * process and never disposes it (the process exits shortly after). The
 * disposer exists primarily so tests can avoid leaking listeners across cases
 * (each test invocation installs and tears down its own listener).
 */
export function setupUnhandledRejectionHandler(): () => void {
  let unhandledRejectionOccurred = false;
  const handler = (reason: unknown) => {
    appendInteractiveUiDebug(`unhandled-rejection ${String(reason)}`);
    const errorMessage = `=========================================
This is an unexpected error. Please file a bug report using the /bug tool.
CRITICAL: Unhandled Promise Rejection!
=========================================
Reason: ${reason}${
      reason instanceof Error && reason.stack
        ? `
Stack trace:
${reason.stack}`
        : ''
    }`;
    appEvents.emit(AppEvent.LogError, errorMessage);
    if (!unhandledRejectionOccurred) {
      unhandledRejectionOccurred = true;
      appEvents.emit(AppEvent.OpenDebugConsole);
    }
  };
  process.on('unhandledRejection', handler);
  return () => {
    process.off('unhandledRejection', handler);
  };
}

function appendInteractiveUiDebug(message: string): void {
  const artifactDir = process.env.LLXPRT_TMUX_ARTIFACT_DIR;
  if (!artifactDir) return;
  try {
    appendFileSync(join(artifactDir, 'cli-debug.log'), `${message}\n`);
  } catch {
    // Ignore diagnostics failures; they should not affect CLI startup.
  }
}

function handleError(error: Error, errorInfo: ErrorInfo) {
  appendInteractiveUiDebug(
    `error-boundary ${error.message}\n${error.stack ?? ''}\n${errorInfo.componentStack}`,
  );
  // Log to console for debugging
  debugLogger.error('Application Error:', error);
  debugLogger.error('Component Stack:', errorInfo.componentStack);

  // Special handling for maximum update depth errors
  if (error.message.includes('Maximum update depth exceeded')) {
    debugLogger.error('\nCRITICAL: RENDER LOOP DETECTED!');
    debugLogger.error('This is likely caused by:');
    debugLogger.error('- State updates during render');
    debugLogger.error('- Incorrect useEffect dependencies');
    debugLogger.error('- Non-memoized props causing re-renders');
    debugLogger.error('\nCheck recent changes to React components and hooks.');
  }
}

/**
 * Module-level guard ensuring the title-reset exit listener is registered at
 * most once per process. setWindowTitle is called on every interactive
 * session; without this guard, each call appends a duplicate process.on('exit')
 * listener that accumulates over the process lifetime.
 */
let titleResetExitListenerRegistered = false;

/**
 * Module-level mouse-events teardown handler for the process 'exit' event.
 *
 * Must be module-level (not a local inside startInteractiveUI) so the SAME
 * function reference is passed to process.off and process.on across repeated
 * startInteractiveUI calls. A local named function would be a fresh reference
 * each call, so process.off could never remove a previously-registered
 * listener and duplicates would still accumulate. disableMouseEvents and the
 * TTY-guarded disable-sequence writes are individually idempotent, so running
 * this handler once (via the idempotent registration below) is correct.
 */
function mouseEventsExitHandler(): void {
  disableMouseEvents();
  if (process.stdout.isTTY) {
    writeToStdout(
      DISABLE_BRACKETED_PASTE + DISABLE_FOCUS_TRACKING + SHOW_CURSOR,
    );
  }
}

export function setWindowTitle(title: string, settings: LoadedSettings) {
  if (settings.merged.ui.hideWindowTitle !== true) {
    // Initial state before React loop starts
    const windowTitle = computeTerminalTitle({
      streamingState: StreamingState.Idle,
      isConfirming: false,
      folderName: title,
      showThoughts: settings.merged.ui.showStatusInTitle === true,
      useDynamicTitle: settings.merged.ui.dynamicWindowTitle ?? true,
    });
    writeToStdout(`\x1b]0;${windowTitle}\x07`);

    // Register the title-reset listener only once per process; multiple
    // interactive sessions in the same process would otherwise accumulate
    // duplicate exit listeners.
    if (!titleResetExitListenerRegistered) {
      titleResetExitListenerRegistered = true;
      process.on('exit', () => {
        writeToStdout(`\x1b]0;\x07`);
      });
    }
  }
}

export function initializeOutputListenersAndFlush() {
  // If there are no listeners for output, make sure we flush so output is not
  // lost.
  if (coreEvents.listenerCount(CoreEvent.Output) === 0) {
    // In non-interactive mode, ensure we drain any buffered output or logs to stderr
    coreEvents.on(CoreEvent.Output, (payload: OutputPayload) => {
      if (payload.isStderr) {
        writeToStderr(payload.chunk, payload.encoding);
      } else {
        writeToStdout(payload.chunk, payload.encoding);
      }
    });

    coreEvents.on(CoreEvent.ConsoleLog, (payload: ConsoleLogPayload) => {
      if (payload.type === 'error' || payload.type === 'warn') {
        writeToStderr(payload.content);
      } else {
        writeToStdout(payload.content);
      }
    });
  }
  coreEvents.drainBacklogs();
}

/**
 * @plan:PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines 115-132
 */
export async function startInteractiveUI(
  // `config` remains a temporary migration bridge alongside the Agent until the
  // remaining UI Config consumers are migrated (see #1595).
  config: Config,
  agent: Agent,
  settings: LoadedSettings,
  startupWarnings: string[],
  workspaceRoot: string,
  runtimeMessageBus?: MessageBus,
  recordingIntegration?: RecordingIntegration,
  resumedHistory?: IContent[],
  initialRecordingService?: SessionRecordingService,
  initialLockHandle?: LockHandle | null,
) {
  const version = await getCliVersion();

  appendInteractiveUiDebug(
    `startInteractiveUI version=${version} stdoutTTY=${String(process.stdout.isTTY)} columns=${String(process.stdout.columns)} rows=${String(process.stdout.rows)} builtinOnly=${String(process.env.LLXPRT_CODE_BUILTIN_COMMANDS_ONLY)} suppressStatic=${String(process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER)}`,
  );
  setWindowTitle(basename(workspaceRoot), settings);

  const renderOptions = inkRenderOptions(config, settings);
  appendInteractiveUiDebug(
    `renderOptions alternateBuffer=${String(renderOptions.alternateBuffer)} incrementalRendering=${String(renderOptions.incrementalRendering)} stdoutColumns=${String(renderOptions.stdout?.columns)} stdoutRows=${String(renderOptions.stdout?.rows)}`,
  );
  const mouseEventsEnabled = isMouseEventsEnabled(renderOptions, settings);
  if (mouseEventsEnabled) {
    enableMouseEvents();
    // Register the mouse-events teardown idempotently. startInteractiveUI may
    // be called more than once in a long-lived process (e.g. tests); a bare
    // process.on('exit', ...) with an inline arrow would accumulate a new
    // listener (and a fresh closure) on every call. mouseEventsExitHandler is
    // module-level, so process.off removes the exact prior registration (a
    // no-op on the first call) and process.on re-adds the single listener.
    // process.on('exit') is used instead of registerCleanup because
    // registerCleanup includes instance.waitUntilExit() which would deadlock
    // on quit. The 'exit' event fires synchronously during process.exit()
    // (fixes #959).
    process.off('exit', mouseEventsExitHandler);
    process.on('exit', mouseEventsExitHandler);
  }

  // Register the exit listener idempotently: startInteractiveUI may be called
  // more than once in a long-lived process (e.g. tests), and a bare
  // process.on('exit', ...) would accumulate duplicate listeners that each
  // re-run the (idempotent) terminal-protocol restoration. process.off first
  // (a no-op when not yet registered) keeps registration to exactly one
  // listener across calls while preserving the registerSyncCleanup path.
  process.off('exit', restoreTerminalProtocolsSync);
  process.on('exit', restoreTerminalProtocolsSync);
  // Also register the synchronous restoration for the runExitCleanup() path
  // (non-interactive sessions call runExitCleanup before process.exit, where
  // process 'exit' listeners have not yet fired). restoreTerminalProtocolsSync
  // is idempotent (guarded by isTTY + writes only disable sequences), so
  // running it both here and via process.on('exit') is harmless.
  registerSyncCleanup(restoreTerminalProtocolsSync);

  const instance = render(
    <React.StrictMode>
      <ErrorBoundary onError={handleError}>
        <SettingsContext.Provider value={settings}>
          <AppWrapper
            config={config}
            agent={agent}
            settings={settings}
            runtimeMessageBus={runtimeMessageBus}
            startupWarnings={startupWarnings}
            version={version}
            terminalBackgroundColor={config.getTerminalBackground()}
            recordingIntegration={recordingIntegration}
            resumedHistory={resumedHistory}
            initialRecordingService={initialRecordingService}
            initialLockHandle={initialLockHandle}
          />
        </SettingsContext.Provider>
      </ErrorBoundary>
    </React.StrictMode>,
    renderOptions,
  );
  appendInteractiveUiDebug('render returned');

  checkForUpdates(settings)
    .then((info: Awaited<ReturnType<typeof checkForUpdates>>) => {
      handleAutoUpdate(info, settings, config.getProjectRoot());
    })
    .catch((err: unknown) => {
      // Silently ignore update check errors.
      if (config.getDebugMode()) {
        debugLogger.error('Update check failed:', err);
      }
    });

  registerCleanup(async () => {
    await instance.waitUntilExit();
    instance.clear();
    instance.unmount();
  });
}

export interface NonInteractiveSessionOptions {
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
  sessionMessageBus: MessageBus;
}

export interface PipedOrPromptSessionOptions {
  config: Config;
  settings: LoadedSettings;
  sessionMessageBus: MessageBus;
  initialInput: string | undefined;
  hasPipedInput: boolean;
  readStdinData: () => Promise<string>;
}

export interface SessionDispatchOptions {
  config: Config;
  settings: LoadedSettings;
  workspaceRoot: string;
  sessionMessageBus: MessageBus;
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
  settings,
  workspaceRoot,
  sessionMessageBus,
  recording,
  hasPipedInput,
  readStdinData,
}: SessionDispatchOptions): Promise<void> {
  const input = config.getQuestion();
  const startupWarnings = [
    ...(await getStartupWarnings()),
    ...(await getUserStartupWarnings(settings.merged)),
  ];

  // Render UI, passing necessary config values. Check that there is no command line question.
  if (typeof config.isInteractive === 'function' && config.isInteractive()) {
    // Create the single interactive Agent at the composition root. `fromConfig`
    // fires the SessionStart hook internally via the same core hook, so the
    // interactive branch no longer fires it explicitly (the non-interactive
    // branch keeps its own explicit call since it builds no Agent).
    const agent = await createForegroundAgent({ config, sessionMessageBus });

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
    settings,
    sessionMessageBus,
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
  settings,
  sessionMessageBus,
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

  if (isTelemetrySdkInitialized()) {
    await shutdownTelemetry(config);
  }

  // Call cleanup before process.exit, which causes cleanup to not run
  await runExitCleanup();
  process.exit(nonInteractiveExitCode);
}

/**
 * Drive a single non-interactive run: validate auth, fire session hooks,
 * inject any SessionStart context, run the prompt, and report the exit code.
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
    reportNonInteractiveError(config, error);
    return 1;
  }

  const removeSigintHandler = installNonInteractiveSigintHandler();
  let nonInteractiveExitCode = 0;
  try {
    initializeOutputListenersAndFlush();

    // Fire SessionStart hook for non-interactive mode and inject context
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

    // Fire SessionEnd hook on successful completion
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

    reportNonInteractiveError(nonInteractiveConfig, error);
  } finally {
    removeSigintHandler();
  }
  return nonInteractiveExitCode;
}

/**
 * Format and report a non-interactive error to the appropriate output stream
 * (JSON formatter when JSON output is configured, otherwise the debug logger).
 * Extracted so both the auth-validation catch and the run-phase catch share a
 * single error-reporting path.
 */
function reportNonInteractiveError(config: Config, error: unknown): void {
  if (config.getOutputFormat() === OutputFormat.JSON) {
    const formatter = new JsonFormatter();
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    writeToStderr(`${formatter.formatError(normalizedError, 1)}
`);
  } else {
    const printableError = formatNonInteractiveError(error);
    debugLogger.error(`Non-interactive run failed: ${printableError}`);
  }
}
