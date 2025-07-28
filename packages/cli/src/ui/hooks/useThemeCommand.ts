/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect } from 'react';
import { themeManager } from '../themes/theme-manager.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js'; // Import LoadedSettings, AppSettings, MergedSetting
import { type HistoryItem, MessageType } from '../types.js';
import process from 'node:process';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';

interface UseThemeCommandReturn {
  isThemeDialogOpen: boolean;
  openThemeDialog: () => void;
  handleThemeSelect: (
    themeName: string | undefined,
    scope: SettingScope,
  ) => void; // Added scope
  handleThemeHighlight: (themeName: string | undefined) => void;
}

export const useThemeCommand = (
  loadedSettings: LoadedSettings,
  appState: AppState,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): UseThemeCommandReturn => {
  // Determine the effective theme
  const effectiveTheme = loadedSettings.merged.theme;
  const appDispatch = useAppDispatch();
  const isThemeDialogOpen = appState.openDialogs.theme;

  // Set initial dialog state based on theme availability
  useEffect(() => {
    if (effectiveTheme === undefined && !process.env.NO_COLOR) {
      appDispatch({ type: 'OPEN_DIALOG', payload: 'theme' });
    }
  }, [effectiveTheme, appDispatch]); // Run only on mount

  // Apply initial theme on component mount
  useEffect(() => {
    if (effectiveTheme === undefined) {
      if (process.env.NO_COLOR) {
        addItem(
          {
            type: MessageType.INFO,
            text: 'Theme configuration unavailable due to NO_COLOR env variable.',
          },
          Date.now(),
        );
      }
      // If no theme is set and NO_COLOR is not set, the dialog is already open.
      return;
    }

    // Check for invalid theme configuration on startup
    if (effectiveTheme && !themeManager.findThemeByName(effectiveTheme)) {
      appDispatch({ type: 'OPEN_DIALOG', payload: 'theme' });
      appDispatch({
        type: 'SET_THEME_ERROR',
        payload: `Theme "${effectiveTheme}" not found.`,
      });
    } else {
      appDispatch({ type: 'SET_THEME_ERROR', payload: null });
    }
  }, [effectiveTheme, appDispatch, addItem]); // Re-run if effectiveTheme or appDispatch changes

  const openThemeDialog = useCallback(() => {
    if (process.env.NO_COLOR) {
      addItem(
        {
          type: MessageType.INFO,
          text: 'Theme configuration unavailable due to NO_COLOR env variable.',
        },
        Date.now(),
      );
      return;
    }
    appDispatch({ type: 'OPEN_DIALOG', payload: 'theme' });
  }, [addItem, appDispatch]);

  const applyTheme = useCallback(
    (themeName: string | undefined) => {
      if (!themeManager.setActiveTheme(themeName)) {
        // If theme is not found, open the theme selection dialog and set error message
        appDispatch({ type: 'OPEN_DIALOG', payload: 'theme' });
        appDispatch({
          type: 'SET_THEME_ERROR',
          payload: `Theme "${themeName}" not found.`,
        });
      } else {
        // Force re-render by updating a dummy warning
        appDispatch({
          type: 'SET_WARNING',
          payload: { key: 'theme-render', message: '' },
        });
        appDispatch({ type: 'CLEAR_WARNING', payload: 'theme-render' });
        appDispatch({ type: 'SET_THEME_ERROR', payload: null }); // Clear any previous theme error on success
      }
    },
    [appDispatch],
  );

  const handleThemeHighlight = useCallback(
    (themeName: string | undefined) => {
      applyTheme(themeName);
    },
    [applyTheme],
  );

  const handleThemeSelect = useCallback(
    (themeName: string | undefined, scope: SettingScope) => {
      try {
        // Merge user and workspace custom themes (workspace takes precedence)
        const mergedCustomThemes = {
          ...(loadedSettings.user.settings.customThemes || {}),
          ...(loadedSettings.workspace.settings.customThemes || {}),
        };
        // Only allow selecting themes available in the merged custom themes or built-in themes
        const isBuiltIn = themeManager.findThemeByName(themeName);
        const isCustom = themeName && mergedCustomThemes[themeName];
        if (!isBuiltIn && !isCustom) {
          appDispatch({
            type: 'SET_THEME_ERROR',
            payload: `Theme "${themeName}" not found in selected scope.`,
          });
          appDispatch({ type: 'OPEN_DIALOG', payload: 'theme' });
          return;
        }
        loadedSettings.setValue(scope, 'theme', themeName); // Update the merged settings
        if (loadedSettings.merged.customThemes) {
          themeManager.loadCustomThemes(loadedSettings.merged.customThemes);
        }
        applyTheme(loadedSettings.merged.theme); // Apply the current theme
        appDispatch({ type: 'SET_THEME_ERROR', payload: null });
      } finally {
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'theme' }); // Close the dialog
      }
    },
    [applyTheme, loadedSettings, appDispatch],
  );

  return {
    isThemeDialogOpen,
    openThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
  };
};
