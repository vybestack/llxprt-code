/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AppContainer — thin orchestration shell.
 *
 * All hook extraction, state management, and rendering logic now lives in:
 *   - containers/AppContainer/hooks/useAppBootstrap.ts   (history, session, IO)
 *   - containers/AppContainer/hooks/useAppDialogs.ts     (dialogs, auth, profiles)
 *   - containers/AppContainer/hooks/useAppInput.ts       (input, gemini stream)
 *   - containers/AppContainer/hooks/useAppLayout.ts      (layout, measurements)
 *   - containers/AppContainer/builders/useUIStateBuilder.ts
 *   - containers/AppContainer/builders/useUIActionsBuilder.ts
 *
 * This file is kept for backwards-compatibility — it re-exports the component
 * under the original `AppContainer` name used by App.tsx and the public API.
 */

import React from 'react';
import type {
  Config,
  MessageBus,
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
  IContent,
} from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../config/settings.js';
import type { AppState, AppAction } from './reducers/appReducer.js';
import {
  AppContainerRuntime,
  type AppContainerRuntimeProps,
} from './AppContainerRuntime.js';

export interface AppContainerProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings?: string[];
  resumedHistory?: IContent[];
  version: string;
  terminalBackgroundColor?: string;
  runtimeMessageBus?: MessageBus;
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 */
  recordingIntegration?: RecordingIntegration;
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialRecordingService?: SessionRecordingService;
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialLockHandle?: LockHandle | null;
}

export const AppContainer = (props: AppContainerProps) => (
  <AppContainerRuntime {...(props as AppContainerRuntimeProps)} />
);
