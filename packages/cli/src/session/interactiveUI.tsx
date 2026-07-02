import React, { type ErrorInfo } from 'react';
import { render } from 'ink';
import { AppWrapper } from '../ui/App.js';
import { ErrorBoundary } from '../ui/components/ErrorBoundary.js';
import { basename } from 'node:path';
import { type LoadedSettings } from '../config/settings.js';
import {
  type Config,
  type SessionRecordingService,
  type RecordingIntegration,
  type IContent,
  type LockHandle,
  type MessageBus,
  debugLogger,
  writeToStdout,
} from '@vybestack/llxprt-code-core';
import { getCliVersion } from '../utils/version.js';
import { enableMouseEvents } from '../ui/utils/mouse.js';
import { restoreTerminalProtocolsSync } from '../ui/utils/terminalProtocolCleanup.js';
import { checkForUpdates } from '../ui/utils/updateCheck.js';
import { handleAutoUpdate } from '../utils/handleAutoUpdate.js';
import { SettingsContext } from '../ui/contexts/SettingsContext.js';
import { inkRenderOptions } from '../ui/inkRenderOptions.js';
import { isMouseEventsEnabled } from '../ui/mouseEventsEnabled.js';
import { computeTerminalTitle } from '../utils/windowTitle.js';
import { StreamingState } from '../ui/types.js';
import { registerCleanup, registerSyncCleanup } from '../utils/cleanup.js';
import { appendInteractiveUiDebug } from './debugLog.js';
import { mouseEventsExitHandler } from './terminalCleanup.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

/**
 * Module-level reference to the latest rendered Ink instance.
 *
 * startInteractiveUI may be called more than once in a long-lived process
 * (e.g. tests). registerCleanup appends to a module-level array, so a bare
 * registerCleanup inside startInteractiveUI would accumulate a fresh closure
 * (capturing that call's local `instance`) on every invocation. By tracking
 * the latest instance here and registering the cleanup callback at most once,
 * repeated calls simply update this reference — the single registered
 * callback always tears down whichever instance is current.
 */
let latestInstance: ReturnType<typeof render> | undefined;

/**
 * Idempotent flag so the cleanup callback is registered at most once per
 * process, regardless of how many times startInteractiveUI is called.
 */
let cleanupRegistered = false;

/**
 * Idempotent flag so the synchronous terminal-protocol cleanup is registered
 * at most once per process. registerSyncCleanup appends to a module-level
 * array (it does not dedup), so without this guard repeated startInteractiveUI
 * calls would accumulate duplicate restoreTerminalProtocolsSync entries in
 * syncCleanupFunctions. Mirrors the dedup pattern used by cleanupRegistered
 * and titleResetExitListenerRegistered.
 */
let syncCleanupRegistered = false;

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

function resetTitleExitHandler() {
  writeToStdout(`\x1b]0;\x07`);
}

export function __resetInteractiveUIStateForTesting() {
  latestInstance = undefined;
  cleanupRegistered = false;
  titleResetExitListenerRegistered = false;
  syncCleanupRegistered = false;
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
      process.off('exit', resetTitleExitHandler);
      process.on('exit', resetTitleExitHandler);
    }
  }
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

  let instance: ReturnType<typeof render>;
  try {
    instance = render(
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
  } catch (error) {
    if (mouseEventsEnabled) {
      mouseEventsExitHandler();
      process.off('exit', mouseEventsExitHandler);
    }
    restoreTerminalProtocolsSync();
    process.off('exit', restoreTerminalProtocolsSync);
    throw error;
  }
  appendInteractiveUiDebug('render returned');

  // Also register the synchronous restoration for the runExitCleanup() path
  // (non-interactive sessions call runExitCleanup before process.exit, where
  // process 'exit' listeners have not yet fired). registerSyncCleanup appends
  // to a module-level array without dedup, so guard with syncCleanupRegistered
  // to avoid accumulating duplicate entries across repeated startInteractiveUI
  // calls (e.g. tests). restoreTerminalProtocolsSync is idempotent (guarded
  // by isTTY + writes only disable sequences), so running it both here and via
  // process.on('exit') is harmless.
  if (!syncCleanupRegistered) {
    syncCleanupRegistered = true;
    registerSyncCleanup(restoreTerminalProtocolsSync);
  }

  setupInstanceLifecycle(instance, settings, config);
}

function setupInstanceLifecycle(
  instance: ReturnType<typeof render>,
  settings: LoadedSettings,
  config: Config,
): void {
  checkForUpdates(settings)
    .then((info) => {
      handleAutoUpdate(info, settings, config.getProjectRoot());
    })
    .catch((err: unknown) => {
      // Silently ignore update check errors.
      if (config.getDebugMode()) {
        debugLogger.error('Update check failed:', err);
      }
    });

  // Track the latest instance so the single registered cleanup callback tears
  // down whichever instance is current (not a stale closure from an earlier
  // call). The callback is registered at most once per process.
  latestInstance = instance;
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    registerCleanup(async () => {
      const current = latestInstance;
      if (!current) {
        return;
      }
      // Unmount immediately rather than awaiting waitUntilExit(). During
      // shutdown (e.g. runExitCleanup from the non-interactive path), the Ink
      // instance may never naturally exit, and awaiting it would deadlock
      // runExitCleanup indefinitely, blocking process.exit.
      current.clear();
      current.unmount();
    });
  }
}
