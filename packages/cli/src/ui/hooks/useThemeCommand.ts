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
  setThemeError: (error: string | null) => void,
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
      setThemeError(`Theme "${effectiveTheme}" not found.`);
    } else {
      setThemeError(null);
    }
  }, [effectiveTheme, dialogs, setThemeError, addItem]);
}

export const useThemeCommand = (
  loadedSettings: LoadedSettings,
  dialogs: DialogOpeners,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
  setThemeError: (error: string | null) => void,
): UseThemeCommandReturn => {
  // Determine the effective theme
  const effectiveTheme = loadedSettings.merged.ui.theme;
  const appDispatch = useAppDispatch();

  useInitialDialogState(effectiveTheme, dialogs);
  useThemeValidation(effectiveTheme, dialogs, setThemeError, addItem);

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
        setThemeError(`Theme "${themeName}" not found.`);
      } else {
        // Force re-render by updating a dummy warning
        appDispatch({
          type: 'SET_WARNING',
          payload: { key: 'theme-render', message: '' },
        });
        appDispatch({ type: 'CLEAR_WARNING', payload: 'theme-render' });
        setThemeError(null); // Clear any previous theme error on success
      }
    },
    [dialogs, appDispatch, setThemeError],
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
        setThemeError,
      );
    },
    [applyTheme, loadedSettings, dialogs, setThemeError],
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
  setThemeError: (error: string | null) => void,
): void {
  if (themeName === undefined) {
    dialogs.theme.close();
    setThemeError(null);
    return;
  }
  const mergedCustomThemes = getMergedCustomThemes(loadedSettings);

  if (!isThemeAvailable(themeName, mergedCustomThemes)) {
    reportThemeSelectionError(themeName, setThemeError);
    return;
  }

  loadedSettings.setValue(scope, 'ui.theme', themeName);
  if (loadedSettings.merged.ui.customThemes) {
    themeManager.loadCustomThemes(loadedSettings.merged.ui.customThemes);
  }
  applyTheme(loadedSettings.merged.ui.theme);
  setThemeError(null);
  dialogs.theme.close();
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
  themeName: string,
  setThemeError: (error: string | null) => void,
): void {
  setThemeError(`Theme "${themeName}" not found.`);
}
