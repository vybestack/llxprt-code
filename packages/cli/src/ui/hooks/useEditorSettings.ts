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
  setEditorError: (error: string | null) => void,
): UseEditorSettingsReturn => {
  const openEditorDialog = useCallback(() => {
    setEditorError(null);
    dialogs.editor.open({});
  }, [dialogs, setEditorError]);

  const handleEditorSelect = useCallback(
    (editorType: EditorType | undefined, scope: SettingScope) => {
      if (
        editorType &&
        (!checkHasEditorType(editorType) ||
          !allowEditorTypeInSandbox(editorType))
      ) {
        setEditorError(`Editor "${editorType}" is unavailable.`);
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
        setEditorError(null);
        dialogs.editor.close();
      } catch (error) {
        setEditorError(`Failed to set editor preference: ${error}`);
      }
    },
    [loadedSettings, setEditorError, addItem, dialogs],
  );

  const exitEditorDialog = useCallback(() => {
    setEditorError(null);
    dialogs.editor.close();
  }, [dialogs, setEditorError]);

  return {
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
  };
};
