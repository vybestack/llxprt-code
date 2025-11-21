/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';
import type { IdeIntegrationNudgeResult } from '../IdeIntegrationNudge.js';
import type { HistoryItem } from '../types.js';
import type { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import type { Key } from '../hooks/useKeypress.js';
import type { AuthType, EditorType } from '@vybestack/llxprt-code-core';
import type { SettingScope } from '../../config/settings.js';

/**
 * UI Actions shape for the AppContainer architecture.
 * This consolidates all UI actions/callbacks that were previously
 * scattered across the monolithic App.tsx component.
 */
export interface UIActions {
  // History actions
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => number;
  clearItems: () => void;
  loadHistory: (newHistory: HistoryItem[]) => void;
  refreshStatic: () => void;

  // Input actions
  handleUserInputSubmit: (value: string) => void;
  handleClearScreen: () => void;

  // Theme dialog
  openThemeDialog: () => void;
  handleThemeSelect: (
    themeName: string | undefined,
    scope: SettingScope,
  ) => void;
  handleThemeHighlight: (themeName: string | undefined) => void;

  // Settings dialog
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;
  handleSettingsRestart: () => void;

  // Auth dialog
  openAuthDialog: () => void;
  handleAuthSelect: (
    authType: AuthType | undefined,
    scope: SettingScope,
  ) => Promise<void>;
  cancelAuthentication: () => void;
  handleAuthTimeout: () => void;

  // Editor dialog
  openEditorDialog: () => void;
  handleEditorSelect: (
    editorType: EditorType | undefined,
    scope: SettingScope,
  ) => void;
  exitEditorDialog: () => void;

  // Provider dialog
  openProviderDialog: () => void;
  handleProviderSelect: (provider: string) => Promise<void>;
  exitProviderDialog: () => void;

  // Provider model dialog
  openProviderModelDialog: () => Promise<void>;
  handleProviderModelChange: (model: string) => void;
  exitProviderModelDialog: () => void;

  // Load profile dialog
  openLoadProfileDialog: () => void;
  handleProfileSelect: (profile: string) => void;
  exitLoadProfileDialog: () => void;

  // Tools dialog
  openToolsDialog: (action: 'enable' | 'disable') => void;
  handleToolsSelect: (tool: string) => void;
  exitToolsDialog: () => void;

  // Folder trust dialog
  handleFolderTrustSelect: (choice: FolderTrustChoice) => void;

  // Permissions dialog
  openPermissionsDialog: () => void;
  closePermissionsDialog: () => void;

  // Workspace migration dialog
  onWorkspaceMigrationDialogOpen: () => void;
  onWorkspaceMigrationDialogClose: () => void;

  // Privacy notice
  openPrivacyNotice: () => void;
  handlePrivacyNoticeExit: () => void;

  // OAuth code dialog
  handleOAuthCodeDialogClose: () => void;
  handleOAuthCodeSubmit: (code: string) => Promise<void>;

  // Confirmation handlers
  handleConfirmationSelect: (value: boolean) => void;

  // IDE prompt
  handleIdePromptComplete: (result: IdeIntegrationNudgeResult) => void;

  // Vim
  vimHandleInput: (key: Key) => boolean;
  toggleVimEnabled: () => void;

  // Slash commands
  handleSlashCommand: (command: string) => void;

  // Memory
  performMemoryRefresh: () => Promise<void>;

  // Display toggles
  setShowErrorDetails: (show: boolean) => void;
  setShowToolDescriptions: (show: boolean) => void;
  setConstrainHeight: (constrain: boolean) => void;

  // Shell mode
  setShellModeActive: (active: boolean) => void;

  // Escape prompt
  handleEscapePromptChange: (show: boolean) => void;

  // Cancel ongoing request
  cancelOngoingRequest: (() => void) | undefined;
}

const UIActionsContext = createContext<UIActions | undefined>(undefined);

export function UIActionsProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: UIActions;
}) {
  return (
    <UIActionsContext.Provider value={value}>
      {children}
    </UIActionsContext.Provider>
  );
}

export function useUIActions(): UIActions {
  const context = useContext(UIActionsContext);
  if (!context) {
    throw new Error('useUIActions must be used within a UIActionsProvider');
  }
  return context;
}

export { UIActionsContext };
