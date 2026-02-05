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
import type { EditorType } from '@vybestack/llxprt-code-core';
import type { SettingScope } from '../../config/settings.js';
import type { SubagentView } from '../components/SubagentManagement/types.js';

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
    method: string | undefined,
    scope: SettingScope,
  ) => Promise<void>;
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

  // Load profile dialog
  openLoadProfileDialog: () => void;
  handleProfileSelect: (profile: string) => void;
  exitLoadProfileDialog: () => void;

  // Create profile dialog
  openCreateProfileDialog: () => void;
  exitCreateProfileDialog: () => void;

  // Profile management dialogs
  openProfileListDialog: () => void;
  closeProfileListDialog: () => void;
  viewProfileDetail: (profileName: string, openedDirectly?: boolean) => void;
  closeProfileDetailDialog: () => void;
  loadProfileFromDetail: (profileName: string) => void;
  deleteProfileFromDetail: (profileName: string) => void;
  setProfileAsDefault: (profileName: string) => void;
  openProfileEditor: (profileName: string, openedDirectly?: boolean) => void;
  closeProfileEditor: () => void;
  saveProfileFromEditor: (
    profileName: string,
    updatedProfile: unknown,
  ) => Promise<void>;

  // Tools dialog
  openToolsDialog: (action: 'enable' | 'disable') => void;
  handleToolsSelect: (tool: string) => void;
  exitToolsDialog: () => void;

  // Folder trust dialog
  handleFolderTrustSelect: (choice: FolderTrustChoice) => void;

  // Welcome onboarding
  welcomeActions: {
    startSetup: () => void;
    selectProvider: (providerId: string) => void;
    selectModel: (modelId: string) => void;
    selectAuthMethod: (method: 'oauth' | 'api_key') => void;
    onAuthComplete: () => void;
    onAuthError: (error: string) => void;
    skipSetup: () => void;
    goBack: () => void;
    saveProfile: (name: string) => Promise<void>;
    dismiss: () => void;
    resetAndReopen: () => void;
  };
  triggerWelcomeAuth: (
    provider: string,
    method: 'oauth' | 'api_key',
    apiKey?: string,
  ) => Promise<void>;

  // Permissions dialog
  openPermissionsDialog: () => void;
  closePermissionsDialog: () => void;

  // Logging dialog
  openLoggingDialog: (data?: { entries: unknown[] }) => void;
  closeLoggingDialog: () => void;

  // Subagent dialog
  openSubagentDialog: (
    initialView?: SubagentView,
    initialName?: string,
  ) => void;
  closeSubagentDialog: () => void;

  // Models dialog
  openModelsDialog: (data?: {
    initialSearch?: string;
    initialFilters?: {
      tools?: boolean;
      vision?: boolean;
      reasoning?: boolean;
      audio?: boolean;
    };
    includeDeprecated?: boolean;
  }) => void;
  closeModelsDialog: () => void;

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
  cancelOngoingRequest?: () => void;

  // Queue error message
  setQueueErrorMessage: (message: string | null) => void;
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
