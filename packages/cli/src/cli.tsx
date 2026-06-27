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

const wantWarningSuppression =
  process.env.LLXPRT_SUPPRESS_NODE_WARNINGS !== 'false';
if (wantWarningSuppression && !process.env.NODE_NO_WARNINGS) {
  process.env.NODE_NO_WARNINGS = '1';
  const suppressedWarningCodes = new Set(['DEP0040', 'DEP0169']);
  type WarningMessage =
    | string
    | {
        code?: string;
        stack?: string;
        message?: string;
        [key: string]: unknown;
      };
  process.removeAllListeners('warning');
  process.on('warning', (warning: WarningMessage) => {
    const warningCode =
      typeof warning !== 'string' && typeof warning.code === 'string'
        ? warning.code
        : undefined;
    if (warningCode && suppressedWarningCodes.has(warningCode)) {
      return;
    }
    const message =
      typeof warning === 'string'
        ? warning
        : (warning.stack ?? warning.message ?? String(warning));
    debugLogger.warn(message);
  });
}

import React, { type ErrorInfo } from 'react';
import { render } from 'ink';
import { AppWrapper } from './ui/App.js';
import { ErrorBoundary } from './ui/components/ErrorBoundary.js';
import { parseArguments } from './config/cliArgParser.js';
import { basename } from 'node:path';
import { type LoadedSettings, loadSettings } from './config/settings.js';
import {
  type Config,
  JsonFormatter,
  OutputFormat,
  parseAndFormatApiError,
  type SessionRecordingService,
  type RecordingIntegration,
  type IContent,
  type LockHandle,
  coreEvents,
  CoreEvent,
  type OutputPayload,
  type ConsoleLogPayload,
  patchStdio,
  writeToStderr,
  writeToStdout,
  ExitCodes,
  triggerSessionStartHook,
  triggerSessionEndHook,
  SessionStartSource,
  SessionEndReason,
  type MessageBus,
  debugLogger,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { runStartupMigration } from './config/pathMigration.js';
import {
  cleanupCheckpoints,
  registerCleanup,
  registerSyncCleanup,
  runExitCleanup,
} from './utils/cleanup.js';
import { getCliVersion } from './utils/version.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';
import { runZedIntegration } from './zed-integration/zedIntegration.js';
import { cleanupExpiredSessions } from './utils/sessionCleanup.js';
import { validateNonInteractiveAuth } from './validateNonInterActiveAuth.js';
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
import { computeTerminalTitle } from './utils/windowTitle.js';
import { StreamingState } from './ui/types.js';
import { SettingsContext } from './ui/contexts/SettingsContext.js';
import { inkRenderOptions } from './ui/inkRenderOptions.js';
import { isMouseEventsEnabled } from './ui/mouseEventsEnabled.js';
import { firstNonEmptyString } from './utils/coalesce.js';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  activateConfiguredProvider,
  configureEarlyDebugLogging,
  configureProvidersAndServices,
  connectIdeClientIfEnabled,
  createMemoizedStdinReader,
  ensureAcpProviderActivated,
  ensureStdinOrPromptProvided,
  handleVersionAndHelpFlags,
  initializeConfigWithSpinner,
  maybeHopIntoSandbox,
  maybeRelaunchForMemory,
  prepareTerminalSession,
  redirectConsoleForAcp,
  rejectPromptInteractiveWithPipedStdin,
  throwIfSettingsErrors,
} from './cliBootstrap.js';
import type { CliProviderManager } from './cliBootstrap.js';
import {
  bootstrapRuntimeAndConfig,
  setupSessionRecording,
} from './cliSessionBootstrap.js';
import type { SessionRecordingSetup } from './cliSessionBootstrap.js';

// Re-exported to preserve the public module API consumed by tests and tooling.
export { validateDnsResolutionOrder } from './cliBootstrap.js';

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

export function setupUnhandledRejectionHandler() {
  let unhandledRejectionOccurred = false;
  process.on('unhandledRejection', (reason, _promise) => {
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
  });
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
 * @plan:PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines 115-132
 */
export async function startInteractiveUI(
  config: Config,
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
    // Use process.on('exit') instead of registerCleanup because registerCleanup
    // includes instance.waitUntilExit() which would deadlock on quit.
    // The 'exit' event fires synchronously during process.exit(). (fixes #959)
    process.on('exit', () => {
      disableMouseEvents();
      if (process.stdout.isTTY) {
        writeToStdout(
          DISABLE_BRACKETED_PASTE + DISABLE_FOCUS_TRACKING + SHOW_CURSOR,
        );
      }
    });
  }

  process.on('exit', restoreTerminalProtocolsSync);
  registerSyncCleanup(restoreTerminalProtocolsSync);

  const instance = render(
    <React.StrictMode>
      <ErrorBoundary onError={handleError}>
        <SettingsContext.Provider value={settings}>
          <AppWrapper
            config={config}
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
    .then((info) => {
      handleAutoUpdate(info, settings, config.getProjectRoot());
    })
    .catch((err) => {
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

/**
 * Patch stdio, register flush-on-exit, install the unhandled-rejection handler,
 * and ensure the platform-standard config directory (or legacy fallback) exists. Returns the stdio cleanup.
 */
function setupProcessLifecycle(): () => void {
  const cleanupStdio = patchStdio();
  registerSyncCleanup(() => {
    // This is needed to ensure we don't lose any buffered output.
    initializeOutputListenersAndFlush();
    cleanupStdio();
  });

  setupUnhandledRejectionHandler();

  // Migrate legacy ~/.llxprt/ to platform-standard path (if needed),
  // then ensure the platform directory exists.
  const migrationResult = runStartupMigration();
  if (!migrationResult.migrated && migrationResult.error === true) {
    const legacyDir = Storage.getLegacyLlxprtDir();
    process.stderr.write(
      `Warning: configuration migration failed (${migrationResult.reason}). ` +
        `Falling back to legacy directory ${legacyDir} for this session.\n`,
    );
    process.env['LLXPRT_CONFIG_HOME'] = legacyDir;
  }
  const llxprtDir = Storage.getGlobalConfigDir();
  if (!existsSync(llxprtDir)) {
    mkdirSync(llxprtDir, { recursive: true });
  }
  return cleanupStdio;
}

interface NonInteractiveSessionOptions {
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
  sessionMessageBus: MessageBus;
}

interface PipedOrPromptSessionOptions {
  config: Config;
  settings: LoadedSettings;
  sessionMessageBus: MessageBus;
  initialInput: string | undefined;
  hasPipedInput: boolean;
  readStdinData: () => Promise<string>;
}

interface SessionDispatchOptions {
  config: Config;
  settings: LoadedSettings;
  workspaceRoot: string;
  sessionMessageBus: MessageBus;
  providerManager: CliProviderManager;
  recording: SessionRecordingSetup;
  hasPipedInput: boolean;
  readStdinData: () => Promise<string>;
}

/**
 * Collect startup warnings, then dispatch to either the interactive UI or the
 * piped/prompt non-interactive session depending on the configured mode.
 */
async function dispatchInteractiveOrNonInteractive({
  config,
  settings,
  workspaceRoot,
  sessionMessageBus,
  providerManager,
  recording,
  hasPipedInput,
  readStdinData,
}: SessionDispatchOptions): Promise<void> {
  const input = config.getQuestion();
  const startupWarnings = [
    ...(await getStartupWarnings()),
    ...(await getUserStartupWarnings(settings.merged)),
  ];

  // Check if a provider is already active on startup
  providerManager.getActiveProvider();

  // Render UI, passing necessary config values. Check that there is no command line question.
  if (typeof config.isInteractive === 'function' && config.isInteractive()) {
    // Fire SessionStart hook for interactive mode
    await triggerSessionStartHook(config, SessionStartSource.Startup);

    await startInteractiveUI(
      config,
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
      const existingInput = input ? `${input}` : '';
      input = `${stdinData}

${existingInput}`;
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
  const removeSigintHandler = installNonInteractiveSigintHandler();
  let nonInteractiveExitCode = 0;
  try {
    const nonInteractiveConfig = await validateNonInteractiveAuth(
      settings.merged.useExternalAuth,
      config,
      settings,
    );

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
    // Fire SessionEnd hook on error. validateNonInteractiveAuth calls
    // process.exit on auth failure, so if we reach this catch the config
    // has already been validated/mutated in place and is safe to use.
    await triggerSessionEndHook(config, SessionEndReason.Other);

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
  } finally {
    removeSigintHandler();
  }
  return nonInteractiveExitCode;
}

export async function main() {
  configureEarlyDebugLogging();

  const rawArgs = process.argv.slice(2);
  await handleVersionAndHelpFlags(rawArgs);

  const cleanupStdio = setupProcessLifecycle();

  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);

  await maybeRelaunchForMemory(settings);

  const argv = await parseArguments(settings.merged);

  const hasPipedInput = !process.stdin.isTTY && argv.experimentalAcp !== true;
  const readStdinOnce = createMemoizedStdinReader();

  const questionFromArgs =
    firstNonEmptyString(argv.promptInteractive, argv.prompt) ??
    (argv.promptWords ?? []).join(' ');

  await cleanupCheckpoints();

  await ensureStdinOrPromptProvided(
    hasPipedInput,
    readStdinOnce,
    questionFromArgs,
  );
  throwIfSettingsErrors(settings);
  redirectConsoleForAcp(argv);

  const { config, sessionMessageBus, runtimeSettingsService } =
    await bootstrapRuntimeAndConfig(settings, argv, workspaceRoot);

  await rejectPromptInteractiveWithPipedStdin(argv);

  await prepareTerminalSession(config, settings, argv);

  const providerManager = await configureProvidersAndServices(
    config,
    settings,
    argv,
    runtimeSettingsService,
  );

  if (config.getListExtensions()) {
    process.exit(0);
  }

  setMaxSizedBoxDebugging(config.getDebugMode());

  await initializeConfigWithSpinner(config, sessionMessageBus);
  await connectIdeClientIfEnabled(config);

  // If a provider is specified, activate it after initialization
  const initialAuthFailed = await activateConfiguredProvider(
    config,
    providerManager,
    argv,
  );

  // hop into sandbox if we are outside and sandboxing is enabled
  await maybeHopIntoSandbox({
    config,
    settings,
    argv,
    workspaceRoot,
    runtimeSettingsService,
    initialAuthFailed,
    readStdin: readStdinOnce,
    hasPipedInput,
  });

  if (initialAuthFailed) {
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }

  // Cleanup sessions after config initialization
  await cleanupExpiredSessions(config, settings.merged);

  const recording = await setupSessionRecording(config, argv);

  if (config.getExperimentalZedIntegration()) {
    // Restore real stdout/stderr — ACP uses stdout as its protocol pipe
    cleanupStdio();
    ensureAcpProviderActivated(config);
    await runZedIntegration(config, settings);
    return;
  }

  await dispatchInteractiveOrNonInteractive({
    config,
    settings,
    workspaceRoot,
    sessionMessageBus,
    providerManager,
    recording,
    hasPipedInput,
    readStdinData: readStdinOnce,
  });
}

function setWindowTitle(title: string, settings: LoadedSettings) {
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

    process.on('exit', () => {
      writeToStdout(`\x1b]0;\x07`);
    });
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
