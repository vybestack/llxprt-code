/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { LoadedSettings, type Settings } from '../config/settings.js';
import { KeypressProvider } from '../ui/contexts/KeypressContext.js';
import { SettingsContext } from '../ui/contexts/SettingsContext.js';
import { UIStateContext, type UIState } from '../ui/contexts/UIStateContext.js';
import { StreamingState } from '../ui/types.js';

const mockSettings = new LoadedSettings(
  { path: '', settings: {} },
  { path: '', settings: {} },
  { path: '', settings: {} },
  { path: '', settings: {} },
  true,
);

export const createMockSettings = (
  overrides: Partial<Settings>,
): LoadedSettings => {
  const settings = overrides as Settings;
  return new LoadedSettings(
    { path: '', settings: {} },
    { path: '', settings: {} },
    { path: '', settings },
    { path: '', settings: {} },
    true,
  );
};

// A minimal mock UIState to satisfy the context provider.
// Tests that need specific UIState values should provide their own.
const baseMockUiState: Partial<UIState> = {
  streamingState: StreamingState.Idle,
  mainAreaWidth: 100,
  terminalWidth: 120,
};

export const renderWithProviders = (
  component: React.ReactElement,
  {
    kittyProtocolEnabled = true,
    settings = mockSettings,
    uiState = baseMockUiState,
  }: {
    kittyProtocolEnabled?: boolean;
    settings?: LoadedSettings;
    uiState?: Partial<UIState>;
  } = {},
): ReturnType<typeof render> =>
  render(
    <SettingsContext.Provider value={settings}>
      <UIStateContext.Provider value={uiState as UIState}>
        <KeypressProvider kittyProtocolEnabled={kittyProtocolEnabled}>
          {component}
        </KeypressProvider>
      </UIStateContext.Provider>
    </SettingsContext.Provider>,
  );
