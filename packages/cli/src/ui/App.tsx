/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useReducer } from 'react';
import type { Config } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../config/settings.js';
import { KeypressProvider } from './contexts/KeypressContext.js';
import { MouseProvider } from './contexts/MouseContext.js';
import { SessionStatsProvider } from './contexts/SessionContext.js';
import { VimModeProvider } from './contexts/VimModeContext.js';
import { ToolCallProvider } from './contexts/ToolCallProvider.js';
import { TodoProvider } from './contexts/TodoProvider.js';
import { RuntimeContextProvider } from './contexts/RuntimeContext.js';
import { OverflowProvider } from './contexts/OverflowContext.js';
import { AppDispatchProvider } from './contexts/AppDispatchContext.js';
import { ScrollProvider } from './contexts/ScrollProvider.js';
import { useKittyKeyboardProtocol } from './hooks/useKittyKeyboardProtocol.js';
import { appReducer, initialAppState } from './reducers/appReducer.js';
import { AppContainer } from './AppContainer.js';

interface AppProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings?: string[];
  version: string;
}

/**
 * AppWrapper is the main entry point for the CLI UI.
 * It sets up the provider stack that wraps the AppContainer.
 *
 * Provider stack (outermost to innermost):
 * - KeypressProvider: Terminal keypress handling with Kitty/Vim support
 * - SessionStatsProvider: Session statistics tracking
 * - VimModeProvider: Vim mode state management
 * - ToolCallProvider: Tool call tracking
 * - TodoProvider: Todo list management
 * - RuntimeContextProvider: Runtime API access
 * - OverflowProvider: Overflow detection for UI
 * - AppDispatchProvider: App state dispatch
 * - AppContainer: Main UI container with UIState/UIActions contexts
 */
export const AppWrapper = (props: AppProps) => {
  const kittyProtocolStatus = useKittyKeyboardProtocol();
  const mouseEventsEnabled =
    props.settings.merged.ui?.useAlternateBuffer === true &&
    !props.config.getScreenReader();

  return (
    <KeypressProvider
      kittyProtocolEnabled={kittyProtocolStatus.enabled}
      config={props.config}
      debugKeystrokeLogging={props.settings.merged.debugKeystrokeLogging}
      mouseEventsEnabled={mouseEventsEnabled}
    >
      <MouseProvider
        mouseEventsEnabled={mouseEventsEnabled}
        debugKeystrokeLogging={props.settings.merged.debugKeystrokeLogging}
      >
        <ScrollProvider>
          <SessionStatsProvider>
            <VimModeProvider settings={props.settings}>
              <ToolCallProvider sessionId={props.config.getSessionId()}>
                <TodoProvider sessionId={props.config.getSessionId()}>
                  <RuntimeContextProvider>
                    <OverflowProvider>
                      <AppWithState {...props} />
                    </OverflowProvider>
                  </RuntimeContextProvider>
                </TodoProvider>
              </ToolCallProvider>
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
