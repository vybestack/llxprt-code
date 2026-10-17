/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  IContent,
  LockHandle,
  MessageBus,
  RecordingIntegration,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { MemoryTokenStore } from '../../../providers/src/auth/__tests__/behavioral/test-utils.js';
import type { LoadedSettings } from '../config/settings.js';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
import { startInteractiveUI as startOwnedInteractiveUI } from '../session/interactiveUI.js';

type Startup = Parameters<typeof startOwnedInteractiveUI>[5];
export function startInteractiveUI(
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
  suppressStartupWelcome?: boolean,
  recordingOwner?: 'raw',
  sessionPersistence?: CliSessionPersistencePort,
  runtimeSettings?: Startup['runtimeSettings'],
) {
  if (recordingOwner !== 'raw' || runtimeSettings === undefined)
    throw new Error(
      'Raw startup fixtures require explicit recording and settings owners',
    );
  return startOwnedInteractiveUI(
    config,
    agent,
    settings,
    startupWarnings,
    workspaceRoot,
    {
      recordingOwner,
      oauthManager: new OAuthManager(new MemoryTokenStore()),
      runtimeSettings,
      sessionPersistence,
      runtimeMessageBus,
      recordingIntegration,
      resumedHistory,
      initialRecordingService,
      initialLockHandle,
      suppressStartupWelcome,
    },
  );
}
