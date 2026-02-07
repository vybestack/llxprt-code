/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { type HistoryItem, MessageType } from '../types.js';
import {
  allowEditorTypeInSandbox,
  checkHasEditorType,
  EditorType,
} from '@vybestack/llxprt-code-core';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';

import { SettingPaths } from '../../config/settingPaths.js';

interface UseEditorSettingsReturn {
  isEditorDialogOpen: boolean;
  openEditorDialog: () => void;
  handleEditorSelect: (
    editorType: EditorType | undefined,
    scope: SettingScope,
  ) => void;
  exitEditorDialog: () => void;
}

export const useEditorSettings = (
  loadedSettings: LoadedSettings,
  appState: AppState,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): UseEditorSettingsReturn => {
  const appDispatch = useAppDispatch();
  const isEditorDialogOpen = appState.openDialogs.editor;

  const openEditorDialog = useCallback(() => {
    appDispatch({ type: 'OPEN_DIALOG', payload: 'editor' });
  }, [appDispatch]);

  const handleEditorSelect = useCallback(
    (editorType: EditorType | undefined, scope: SettingScope) => {
      if (
        editorType &&
        (!checkHasEditorType(editorType) ||
          !allowEditorTypeInSandbox(editorType))
      ) {
        return;
      }

      try {
        loadedSettings.setValue(
          scope,
          SettingPaths.General.PreferredEditor,
          editorType,
        );
        addItem(
          {
            type: MessageType.INFO,
            text: `Editor preference ${editorType ? `set to "${editorType}"` : 'cleared'} in ${scope} settings.`,
          },
          Date.now(),
        );
        appDispatch({ type: 'SET_EDITOR_ERROR', payload: null });
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'editor' });
      } catch (error) {
        appDispatch({
          type: 'SET_EDITOR_ERROR',
          payload: `Failed to set editor preference: ${error}`,
        });
      }
    },
    [loadedSettings, appDispatch, addItem],
  );

  const exitEditorDialog = useCallback(() => {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'editor' });
  }, [appDispatch]);

  return {
    isEditorDialogOpen,
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
  };
};
