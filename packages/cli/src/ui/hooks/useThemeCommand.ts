/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect } from 'react';
import { themeManager } from '../themes/theme-manager.js';
import type { LoadedSettings, SettingScope } from '../../config/settings.js'; // Import LoadedSettings, AppSettings, MergedSetting
import { type HistoryItem, MessageType } from '../types.js';
import process from 'node:process';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import type { AppState } from '../reducers/appReducer.js';

interface UseThemeCommandReturn {
  isThemeDialogOpen: boolean;
  openThemeDialog: () => void;
  handleThemeSelect: (
    themeName: string | undefined,
    scope: SettingScope,
  ) => void; // Added scope
  handleThemeHighlight: (themeName: string | undefined) => void;
}

function getMergedCustomThemes(
  loadedSettings: LoadedSettings,
): Record<string, unknown> {
  return {
    ...(loadedSettings.user.settings.ui?.customThemes ?? {}),
    ...(loadedSettings.workspace.settings.ui?.customThemes ?? {}),
  };
}

function isThemeAvailable(
  themeName: string | undefined,
  mergedCustomThemes: Record<string, unknown>,
): boolean {
  const isBuiltIn = themeManager.findThemeByName(themeName);
  const isBuiltInFound = isBuiltIn !== undefined;
  const isCustom =
    themeName !== undefined && Boolean(mergedCustomThemes[themeName]);
  return isBuiltInFound || isCustom;
}

function reportThemeSelectionError(
  themeName: string | undefined,
  appDispatch: ReturnType<typeof useAppDispatch>,
): void {
  appDispatch({
    type: 'SET_THEME_ERROR',
    payload: `Theme "${themeName}" not found in selected scope.`,
  });
  appDispatch({ type: 'OPEN_DIALOG', payload: 'theme' });
}

function performThemeSelection(
  themeName: string | undefined,
  scope: SettingScope,
  loadedSettings: LoadedSettings,
  applyTheme: (themeName: string | undefined) => void,
  appDispatch: ReturnType<typeof useAppDispatch>,
): void {
  try {
    const mergedCustomThemes = getMergedCustomThemes(loadedSettings);

    if (!isThemeAvailable(themeName, mergedCustomThemes)) {
      reportThemeSelectionError(themeName, appDispatch);
      return;
    }

    loadedSettings.setValue(scope, 'ui.theme', themeName);
    if (loadedSettings.merged.ui.customThemes) {
      themeManager.loadCustomThemes(loadedSettings.merged.ui.customThemes);
    }
    applyTheme(loadedSettings.merged.ui.theme);
    appDispatch({ type: 'SET_THEME_ERROR', payload: null });
  } finally {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'theme' });
  }
}

function useInitialDialogState(
  effectiveTheme: string | undefined,
  appDispatch: ReturnType<typeof useAppDispatch>,
): void {
  useEffect(() => {
    if (effectiveTheme === undefined && !process.env.NO_COLOR) {
      appDispatch({ type: 'OPEN_DIALOG', payload: 'theme' });
    }
  }, [effectiveTheme, appDispatch]);
}

function useThemeValidation(
  effectiveTheme: string | undefined,
  appDispatch: ReturnType<typeof useAppDispatch>,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): void {
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
      return;
    }

    if (effectiveTheme && !themeManager.findThemeByName(effectiveTheme)) {
      appDispatch({ type: 'OPEN_DIALOG', payload: 'theme' });
      appDispatch({
        type: 'SET_THEME_ERROR',
        payload: `Theme "${effectiveTheme}" not found.`,
      });
    } else {
      appDispatch({ type: 'SET_THEME_ERROR', payload: null });
    }
  }, [effectiveTheme, appDispatch, addItem]);
}

export const useThemeCommand = (
  loadedSettings: LoadedSettings,
  appState: AppState,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): UseThemeCommandReturn => {
  // Determine the effective theme
  const effectiveTheme = loadedSettings.merged.ui.theme;
  const appDispatch = useAppDispatch();
  const isThemeDialogOpen = appState.openDialogs.theme;

  useInitialDialogState(effectiveTheme, appDispatch);
  useThemeValidation(effectiveTheme, appDispatch, addItem);

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
      performThemeSelection(
        themeName,
        scope,
        loadedSettings,
        applyTheme,
        appDispatch,
      );
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
