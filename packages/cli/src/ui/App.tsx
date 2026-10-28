/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ComponentProps, ReactNode } from 'react';
import { AppProviders, AppWithState } from './app-providers.js';

export type AppProps = ComponentProps<typeof AppWithState> &
  Pick<
    ComponentProps<typeof AppProviders>,
    'renderRuntime' | 'oauthControl' | 'providerAliasRefresh' | 'metrics'
  >;

export function AppWrapper(props: AppProps): ReactNode {
  return (
    <AppProviders
      metrics={props.metrics}
      screenReaderEnabled={props.containerApp.getScreenReader()}
      settings={props.settings}
      sessionId={props.containerSession.getSessionId()}
      renderRuntime={props.renderRuntime}
      oauthControl={props.oauthControl}
      providerAliasRefresh={props.providerAliasRefresh}
    >
      <AppWithState {...props} />
    </AppProviders>
  );
}
