/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useReducer } from 'react';
import type {
  IContent,
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import type { SlashCommandRuntime, UiRuntime } from './cliUiRuntime.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { OperationLifecycleRegistry } from './hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from './hooks/memoryTrend/memoryTelemetry.js';
import { KeypressProvider } from './contexts/KeypressContext.js';
import { MouseProvider } from './contexts/MouseContext.js';
import { SessionStatsProvider } from './contexts/SessionContext.js';
import { VimModeProvider } from './contexts/VimModeContext.js';
import { TodoProvider } from './contexts/TodoProvider.js';
import {
  RuntimeContextProvider,
  type RuntimeContextProviderProps,
} from './contexts/RuntimeContext.js';
import { OverflowProvider } from './contexts/OverflowContext.js';
import {
  ProviderAliasRefreshProvider,
  type ProviderAliasRefresh,
} from './contexts/ProviderAliasRefreshContext.js';
import {
  OAuthControlProvider,
  type OAuthControl,
} from './contexts/OAuthControlContext.js';
import { AppDispatchProvider } from './contexts/AppDispatchContext.js';
import { ScrollProvider } from './contexts/ScrollProvider.js';
import { ShellCommandDisplayProvider } from './contexts/ShellCommandDisplayContext.js';
import { inkRenderOptions } from './inkRenderOptions.js';
import { isMouseEventsEnabled } from './mouseEventsEnabled.js';
import { appReducer, initialAppState } from './reducers/appReducer.js';
import { AppContainer } from './AppContainer.js';
import { projectRuntimeAgent } from './contexts/runtimeProfileAgent.js';

interface AppProps {
  uiRuntime: UiRuntime;
  slashCommandRuntime: SlashCommandRuntime;
  /**
   * The single interactive Agent created at the CLI composition root.
   */
  agent: Agent;
  runtimeOwner: { create: () => RuntimeContextProviderProps['owner'] };
  providerAliasRefresh: ProviderAliasRefresh;
  oauthControl: OAuthControl;
  settings: LoadedSettings;
  startupWarnings?: string[];
  resumedHistory?: IContent[];
  version: string;
  terminalBackgroundColor?: string;
  runtimeMessageBus?: MessageBus;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 */
  recordingIntegration?: RecordingIntegration;
  recordingOwner?: 'agent' | 'raw';
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialRecordingService?: SessionRecordingService;
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialLockHandle?: LockHandle | null;
  suppressStartupWelcome?: boolean;
  /** P12: optional perf operation lifecycle registry (perf enabled only). */
  operationLifecycle?: OperationLifecycleRegistry;
  /** P12: optional memory telemetry controller (perf+memory enabled only). */
  memoryController?: MemoryTelemetryController;
}

/**
 * AppWrapper is the main entry point for the CLI UI.
 * It sets up the provider stack that wraps the AppContainer.
 *
 * Provider stack (outermost to innermost):
 * - KeypressProvider: Terminal keypress handling with Kitty/Vim support
 * - SessionStatsProvider: Session statistics tracking
 * - VimModeProvider: Vim mode state management
 * - TodoProvider: Todo list management
 * - RuntimeContextProvider: Runtime API access
 * - OverflowProvider: Overflow detection for UI
 * - AppDispatchProvider: App state dispatch
 * - AppContainer: Main UI container with UIState/UIActions contexts
 */
export const AppWrapper = (props: AppProps) => {
  const { runtimeOwner: ownerFeatures } = props;
  const runtimeOwner = useMemo(() => ownerFeatures.create(), [ownerFeatures]);
  const runtimeAgent = useMemo(
    () => projectRuntimeAgent(props.agent),
    [props.agent],
  );
  const renderOptions = inkRenderOptions(props.uiRuntime.app, props.settings);
  const mouseEventsEnabled = isMouseEventsEnabled(
    renderOptions,
    props.settings,
  );

  return (
    <KeypressProvider>
      <MouseProvider mouseEventsEnabled={mouseEventsEnabled}>
        <ScrollProvider>
          <SessionStatsProvider>
            <VimModeProvider settings={props.settings}>
              <ShellCommandDisplayProvider
                alwaysDisplayFullShellCommand={
                  props.settings.merged.ui.alwaysDisplayFullShellCommand ?? true
                }
              >
                <TodoProvider
                  sessionId={props.uiRuntime.session.getSessionId()}
                >
                  <RuntimeContextProvider
                    agent={runtimeAgent}
                    owner={runtimeOwner}
                  >
                    <OAuthControlProvider control={props.oauthControl}>
                      <ProviderAliasRefreshProvider
                        refresh={props.providerAliasRefresh}
                      >
                        <OverflowProvider>
                          <AppWithState {...props} />
                        </OverflowProvider>
                      </ProviderAliasRefreshProvider>
                    </OAuthControlProvider>
                  </RuntimeContextProvider>
                </TodoProvider>
              </ShellCommandDisplayProvider>
            </VimModeProvider>
          </SessionStatsProvider>
        </ScrollProvider>
      </MouseProvider>
    </KeypressProvider>
  );
};

/**
 * AppWithState manages the app reducer state and wraps AppContainer.
 */
const AppWithState = (props: AppProps) => {
  const [appState, appDispatch] = useReducer(appReducer, initialAppState);

  return (
    <AppDispatchProvider value={appDispatch}>
      <AppContainer {...props} appState={appState} appDispatch={appDispatch} />
    </AppDispatchProvider>
  );
};

// Re-export for backwards compatibility
export { AppContainer } from './AppContainer.js';
