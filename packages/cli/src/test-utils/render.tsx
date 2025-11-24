/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { LoadedSettings } from '../config/settings.js';
import { KeypressProvider } from '../ui/contexts/KeypressContext.js';
import { SettingsContext } from '../ui/contexts/SettingsContext.js';

const mockSettings = new LoadedSettings(
  { path: '', settings: {} },
  { path: '', settings: {} },
  { path: '', settings: {} },
  { path: '', settings: {} },
  true,
);

export const renderWithProviders = (
  component: React.ReactElement,
  {
    kittyProtocolEnabled = true,
    settings = mockSettings,
  }: {
    kittyProtocolEnabled?: boolean;
    settings?: LoadedSettings;
  } = {},
): ReturnType<typeof render> =>
  render(
    <SettingsContext.Provider value={settings}>
      <KeypressProvider kittyProtocolEnabled={kittyProtocolEnabled}>
        {component}
      </KeypressProvider>
    </SettingsContext.Provider>,
  );
