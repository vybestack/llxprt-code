/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { KeypressProvider } from './contexts/KeypressContext.js';
import { MouseProvider } from './contexts/MouseContext.js';
import { SessionStatsProvider } from './contexts/SessionContext.js';
import { VimModeProvider } from './contexts/VimModeContext.js';
import { TodoProvider } from './contexts/TodoProvider.js';
import { OverflowProvider } from './contexts/OverflowContext.js';
import { ScrollProvider } from './contexts/ScrollProvider.js';
import { ShellCommandDisplayProvider } from './contexts/ShellCommandDisplayContext.js';
import { useReducer, type ReactNode, type ComponentProps } from 'react';
import {
  OAuthControlProvider,
  type OAuthControl,
} from './contexts/OAuthControlContext.js';
import {
  ProviderAliasRefreshProvider,
  type ProviderAliasRefresh,
} from './contexts/ProviderAliasRefreshContext.js';
import type { LoadedSettings } from '../config/settings.js';

import { appReducer, initialAppState } from './reducers/appReducer.js';
import { AppDispatchProvider } from './contexts/AppDispatchContext.js';
import { AppContainer, type AppContainerProps } from './AppContainer.js';

import { inkRenderOptions } from './inkRenderOptions.js';
import { isMouseEventsEnabled } from './mouseEventsEnabled.js';

export function AppProviders({
  children,
  metrics,
  screenReaderEnabled,
  settings,
  sessionId,
  renderRuntime,
  oauthControl,
  providerAliasRefresh,
}: {
  children: ReactNode;
  metrics: ComponentProps<typeof SessionStatsProvider>['metrics'];
  screenReaderEnabled: boolean;
  settings: LoadedSettings;
  sessionId: string;
  renderRuntime: (children: ReactNode) => ReactNode;
  oauthControl: OAuthControl;
  providerAliasRefresh: ProviderAliasRefresh;
}): ReactNode {
  const mouseEventsEnabled = isMouseEventsEnabled(
    inkRenderOptions({ getScreenReader: () => screenReaderEnabled }, settings),
    settings,
  );
  return (
    <KeypressProvider>
      <MouseProvider mouseEventsEnabled={mouseEventsEnabled}>
        <ScrollProvider>
          <SessionStatsProvider metrics={metrics}>
            <VimModeProvider settings={settings}>
              <ShellCommandDisplayProvider
                alwaysDisplayFullShellCommand={
                  settings.merged.ui.alwaysDisplayFullShellCommand ?? true
                }
              >
                <TodoProvider sessionId={sessionId}>
                  {renderRuntime(
                    <OAuthControlProvider control={oauthControl}>
                      <ProviderAliasRefreshProvider
                        refresh={providerAliasRefresh}
                      >
                        <OverflowProvider>{children}</OverflowProvider>
                      </ProviderAliasRefreshProvider>
                    </OAuthControlProvider>,
                  )}
                </TodoProvider>
              </ShellCommandDisplayProvider>
            </VimModeProvider>
          </SessionStatsProvider>
        </ScrollProvider>
      </MouseProvider>
    </KeypressProvider>
  );
}

export const AppWithState = (
  props: Omit<AppContainerProps, 'appState' | 'appDispatch'>,
) => {
  const [appState, appDispatch] = useReducer(appReducer, initialAppState);

  return (
    <AppDispatchProvider value={appDispatch}>
      <AppContainer {...props} appState={appState} appDispatch={appDispatch} />
    </AppDispatchProvider>
  );
};
