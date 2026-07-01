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
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';
import { basename } from 'node:path';
import { type LoadedSettings } from './config/settings.js';
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
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
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
import { SettingsContext } from './ui/contexts/SettingsContext.js';
import { inkRenderOptions } from './ui/inkRenderOptions.js';
import { isMouseEventsEnabled } from './ui/mouseEventsEnabled.js';
import { computeTerminalTitle } from './utils/windowTitle.js';
import { StreamingState } from './ui/types.js';
import type { SessionRecordingSetup } from './cliSessionBootstrap.js';
import { createForegroundAgent } from './cliAgentBootstrap.js';
import { appendInteractiveUiDebug } from './cliProcessUtils.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { registerCleanup, registerSyncCleanup } from './utils/cleanup.js';

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
  setMaxSizedBoxDebugging(config.getDebugMode());
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

export interface SessionDispatchOptions {
  config: Config;
  settings: LoadedSettings;
  workspaceRoot: string;
  sessionMessageBus: MessageBus;
  recording: SessionRecordingSetup;
}

/**
 * Collect startup warnings and render the interactive UI. Non-interactive
 * routing happens in cli.tsx to keep this UI-heavy module off the bundled JSON
 * path.
 */
export async function dispatchInteractiveSession({
  config,
  settings,
  workspaceRoot,
  sessionMessageBus,
  recording,
}: SessionDispatchOptions): Promise<void> {
  const startupWarnings = [
    ...(await getStartupWarnings()),
    ...(await getUserStartupWarnings(settings.merged)),
  ];

  // Create the single interactive Agent at the composition root. `fromConfig`
  // fires the SessionStart hook internally via the same core hook, so the
  // interactive branch no longer fires it explicitly.
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
}
