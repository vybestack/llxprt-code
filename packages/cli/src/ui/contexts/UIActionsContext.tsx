/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { createContext, useContext } from 'react';
import type { IdeIntegrationNudgeResult } from '../IdeIntegrationNudge.js';
import type { HistoryItem } from '../types.js';
import type { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import type { Key } from '../hooks/useKeypress.js';
import type { EditorType } from '@vybestack/llxprt-code-core';
import type { SettingScope } from '../../config/settings.js';

/**
 * UI Actions shape for the AppContainer architecture.
 * This consolidates all UI actions/callbacks that were previously
 * scattered across the monolithic App.tsx component.
 */
export interface UIActions {
  // History actions
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp?: number) => number;
  clearItems: () => void;
  loadHistory: (newHistory: HistoryItem[]) => void;
  refreshStatic: () => void;

  // Input actions
  handleUserInputSubmit: (value: string) => void;
  handleSteer: (text: string) => boolean;
  handleClearScreen: () => void;

  // Theme dialog (open state lives in DialogStore)
  handleThemeSelect: (
    themeName: string | undefined,
    scope: SettingScope,
  ) => void;
  handleThemeHighlight: (themeName: string | undefined) => void;

  // Settings dialog
  handleSettingsRestart: () => void;

  // Auth dialog (open state lives in DialogStore)
  handleAuthSelect: (
    method: string | undefined,
    scope: SettingScope,
  ) => Promise<void>;
  handleAuthTimeout: () => void;

  // Editor dialog (open state lives in DialogStore)
  handleEditorSelect: (
    editorType: EditorType | undefined,
    scope: SettingScope,
  ) => void;

  // Provider dialog (open state lives in DialogStore)
  handleProviderSelect: (provider: string) => Promise<void>;

  // Load profile dialog (open state lives in DialogStore)
  handleProfileSelect: (profile: string) => void;

  // Profile management dialogs (open state lives in DialogStore)
  viewProfileDetail: (profileName: string, openedDirectly?: boolean) => void;
  closeProfileDetailDialog: () => void;
  loadProfileFromDetail: (profileName: string) => void;
  deleteProfileFromDetail: (profileName: string) => void;
  deleteProfileFromList: (profileName: string) => void;
  setProfileAsDefault: (profileName: string) => void;
  openProfileEditor: (profileName: string, openedDirectly?: boolean) => void;
  closeProfileEditor: () => void;
  saveProfileFromEditor: (
    profileName: string,
    updatedProfile: unknown,
  ) => Promise<void>;

  // Tools dialog (open state lives in DialogStore)
  handleToolsSelect: (tool: string) => void;

  // Folder trust dialog
  handleFolderTrustSelect: (choice: FolderTrustChoice) => Promise<void>;

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

  // Workspace migration dialog (open/close state lives in DialogStore)
  onWorkspaceMigrationDialogOpen: () => void;

  // OAuth code dialog
  handleOAuthCodeDialogClose: () => void;
  handleOAuthCodeSubmit: (code: string) => Promise<void>;

  // IDE prompt
  handleIdePromptComplete: (result: IdeIntegrationNudgeResult) => void;

  // Vim
  vimHandleInput: (key: Key) => boolean;
  toggleVimEnabled: () => void;

  // Slash commands
  handleSlashCommand: (command: string) => void;

  // Memory
  performMemoryRefresh: () => Promise<void>;

  // Shell mode
  setShellModeActive: (active: boolean) => void;

  // Escape prompt
  handleEscapePromptChange: (show: boolean) => void;

  // Cancel ongoing request
  cancelOngoingRequest?: () => void;

  // Queue error message
  setQueueErrorMessage: (message: string | null) => void;

  // Queued messages actions (issue #2882)
  sendAllQueuedSubmissions?: () => void;
  steerAllQueuedSubmissions?: () => void;
  clearQueuedSubmissions?: () => void;
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
