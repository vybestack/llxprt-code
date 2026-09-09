/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type { LoadedSettings, SettingScope } from '../../config/settings.js';
import { type HistoryItem, MessageType } from '../types.js';
import type { EditorType } from '@vybestack/llxprt-code-core';
import {
  allowEditorTypeInSandbox,
  checkHasEditorType,
} from '@vybestack/llxprt-code-core';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

import { SettingPaths } from '../../config/settingPaths.js';

interface UseEditorSettingsReturn {
  openEditorDialog: () => void;
  handleEditorSelect: (
    editorType: EditorType | undefined,
    scope: SettingScope,
  ) => void;
  exitEditorDialog: () => void;
}

export const useEditorSettings = (
  loadedSettings: LoadedSettings,
  dialogs: DialogOpeners,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): UseEditorSettingsReturn => {
  const appDispatch = useAppDispatch();

  const openEditorDialog = useCallback(() => {
    dialogs.editor.open({});
  }, [dialogs]);

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
        dialogs.editor.close();
      } catch (error) {
        appDispatch({
          type: 'SET_EDITOR_ERROR',
          payload: `Failed to set editor preference: ${error}`,
        });
      }
    },
    [loadedSettings, appDispatch, addItem, dialogs],
  );

  const exitEditorDialog = useCallback(() => {
    dialogs.editor.close();
  }, [dialogs]);

  return {
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
  };
};
