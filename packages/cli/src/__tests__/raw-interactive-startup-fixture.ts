/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  IContent,
  LockHandle,
  RecordingIntegration,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
import {
  commitInteractiveStartup,
  startInteractiveUI as startOwnedInteractiveUI,
} from '../session/interactiveUI.js';

/**
 * The one place test code starts the interactive UI. Every test that calls
 * `startInteractiveUI` goes through here, so a change to the startup contract
 * is made in this function rather than at each test.
 */
export function startInteractiveUIForTest(
  ...args: Parameters<typeof startOwnedInteractiveUI>
): ReturnType<typeof startOwnedInteractiveUI> {
  return startOwnedInteractiveUI(...args);
}

/**
 * The one place test code commits an interactive startup directly, bypassing
 * the pre-commit stages of `startInteractiveUI`.
 */
export function commitInteractiveStartupForTest(
  ...args: Parameters<typeof commitInteractiveStartup>
): ReturnType<typeof commitInteractiveStartup> {
  return commitInteractiveStartup(...args);
}

type Startup = Parameters<typeof startOwnedInteractiveUI>[5];
export function startInteractiveUI(
  config: Config,
  agent: Agent,
  settings: LoadedSettings,
  startupWarnings: string[],
  workspaceRoot: string,
  recordingIntegration?: RecordingIntegration,
  resumedHistory?: IContent[],
  initialRecordingService?: SessionRecordingService,
  initialLockHandle?: LockHandle | null,
  suppressStartupWelcome?: boolean,
  recordingOwner?: 'raw',
  sessionPersistence?: CliSessionPersistencePort,
  runtimeSettings?: Startup['runtimeSettings'],
) {
  if (recordingOwner !== 'raw' || runtimeSettings === undefined)
    throw new Error(
      'Raw startup fixtures require explicit recording and settings owners',
    );
  return startInteractiveUIForTest(
    config,
    agent,
    settings,
    startupWarnings,
    workspaceRoot,
    {
      recordingOwner,
      runtimeSettings,
      sessionPersistence,
      recordingIntegration,
      resumedHistory,
      initialRecordingService,
      initialLockHandle,
      suppressStartupWelcome,
    },
  );
}
