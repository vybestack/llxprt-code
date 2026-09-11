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
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

interface UseThemeCommandReturn {
  openThemeDialog: () => void;
  handleThemeSelect: (
    themeName: string | undefined,
    scope: SettingScope,
  ) => void; // Added scope
  handleThemeHighlight: (themeName: string | undefined) => void;
}

function useInitialDialogState(
  effectiveTheme: string | undefined,
  dialogs: DialogOpeners,
): void {
  useEffect(() => {
    if (effectiveTheme === undefined && !process.env.NO_COLOR) {
      dialogs.theme.open({});
    }
  }, [effectiveTheme, dialogs]);
}

function useThemeValidation(
  effectiveTheme: string | undefined,
  dialogs: DialogOpeners,
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
      dialogs.theme.open({});
      appDispatch({
        type: 'SET_THEME_ERROR',
        payload: `Theme "${effectiveTheme}" not found.`,
      });
    } else {
      appDispatch({ type: 'SET_THEME_ERROR', payload: null });
    }
  }, [effectiveTheme, dialogs, appDispatch, addItem]);
}

export const useThemeCommand = (
  loadedSettings: LoadedSettings,
  dialogs: DialogOpeners,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): UseThemeCommandReturn => {
  // Determine the effective theme
  const effectiveTheme = loadedSettings.merged.ui.theme;
  const appDispatch = useAppDispatch();

  useInitialDialogState(effectiveTheme, dialogs);
  useThemeValidation(effectiveTheme, dialogs, appDispatch, addItem);

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
    dialogs.theme.open({});
  }, [addItem, dialogs]);

  const applyTheme = useCallback(
    (themeName: string | undefined) => {
      if (!themeManager.setActiveTheme(themeName)) {
        // If theme is not found, open the theme selection dialog and set error message
        dialogs.theme.open({});
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
    [dialogs, appDispatch],
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
        dialogs,
        appDispatch,
      );
    },
    [applyTheme, loadedSettings, dialogs, appDispatch],
  );

  return {
    openThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
  };
};

function performThemeSelection(
  themeName: string | undefined,
  scope: SettingScope,
  loadedSettings: LoadedSettings,
  applyTheme: (themeName: string | undefined) => void,
  dialogs: DialogOpeners,
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
    dialogs.theme.close();
  }
}

function getMergedCustomThemes(loadedSettings: LoadedSettings) {
  return loadedSettings.merged.ui.customThemes;
}

function isThemeAvailable(
  themeName: string | undefined,
  mergedCustomThemes: LoadedSettings['merged']['ui']['customThemes'],
): boolean {
  return (
    themeManager.findThemeByName(themeName) !== undefined ||
    (themeName !== undefined && Boolean(mergedCustomThemes?.[themeName]))
  );
}

function reportThemeSelectionError(
  themeName: string | undefined,
  appDispatch: ReturnType<typeof useAppDispatch>,
): void {
  appDispatch({
    type: 'SET_THEME_ERROR',
    payload:
      themeName === undefined
        ? 'No theme selected.'
        : `Theme "${themeName}" not found.`,
  });
}
