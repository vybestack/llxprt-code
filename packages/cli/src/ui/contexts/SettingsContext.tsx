/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext } from 'react';
import { LoadedSettings } from '../../config/settings.js';

/**
 * Context for accessing the loaded application settings.
 * This provides a centralized way for components to access configuration
 * without prop drilling or direct config module imports.
 */
export const SettingsContext = React.createContext<LoadedSettings | undefined>(
  undefined,
);

/**
 * Provider component for the SettingsContext.
 * Wraps the application to make settings available to all child components.
 *
 * @param props.settings - The loaded settings object.
 * @param props.children - Child components.
 */
export const SettingsProvider: React.FC<{
  settings: LoadedSettings;
  children: React.ReactNode;
}> = ({ settings, children }) => (
  <SettingsContext.Provider value={settings}>
    {children}
  </SettingsContext.Provider>
);

/**
 * Hook to access the current application settings.
 * Throws an error if used outside of a SettingsProvider.
 *
 * @returns The current LoadedSettings object.
 */
export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
