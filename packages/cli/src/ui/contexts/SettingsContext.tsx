/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext } from 'react';
import { LoadedSettings } from '../../config/settings.js';

export const SettingsContext = React.createContext<LoadedSettings | undefined>(
  undefined,
);

export const SettingsProvider: React.FC<{
  settings: LoadedSettings;
  children: React.ReactNode;
}> = ({ settings, children }) => (
  <SettingsContext.Provider value={settings}>
    {children}
  </SettingsContext.Provider>
);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
