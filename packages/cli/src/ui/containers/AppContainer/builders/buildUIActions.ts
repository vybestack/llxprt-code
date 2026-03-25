/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryItem } from '../../../types.js';
import type { FolderTrustChoice } from '../../../components/FolderTrustDialog.js';
import type { Key } from '../../../hooks/useKeypress.js';
import type { EditorType } from '@vybestack/llxprt-code-core';
import type { SettingScope } from '../../../../config/settings.js';
import type { SubagentView } from '../../../components/SubagentManagement/types.js';
import type { IdeIntegrationNudgeResult } from '../../../IdeIntegrationNudge.js';
import type { UIActions } from '../../../contexts/UIActionsContext.js';

/**
 * Parameters for buildUIActions - all action callbacks
 */
export interface UIActionsParams {
  // History actions
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp?: number) => number;
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
  welcomeActions: UIActions['welcomeActions'];
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

  // Session browser dialog
  openSessionBrowserDialog: () => void;
  closeSessionBrowserDialog: () => void;

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

/**
 * @builder buildUIActions
 * @description Pure function assembling UIActions from callbacks
 * @inputs UIActionsParams object with all action callbacks
 * @outputs UIActions object (plain, not memoized)
 * @sideEffects None
 * @strictMode N/A (pure function)
 */
export function buildUIActions(params: UIActionsParams): UIActions {
  return {
    // History actions
    addItem: params.addItem,
    clearItems: params.clearItems,
    loadHistory: params.loadHistory,
    refreshStatic: params.refreshStatic,

    // Input actions
    handleUserInputSubmit: params.handleUserInputSubmit,
    handleClearScreen: params.handleClearScreen,

    // Theme dialog
    openThemeDialog: params.openThemeDialog,
    handleThemeSelect: params.handleThemeSelect,
    handleThemeHighlight: params.handleThemeHighlight,

    // Settings dialog
    openSettingsDialog: params.openSettingsDialog,
    closeSettingsDialog: params.closeSettingsDialog,
    handleSettingsRestart: params.handleSettingsRestart,

    // Auth dialog
    openAuthDialog: params.openAuthDialog,
    handleAuthSelect: params.handleAuthSelect,
    handleAuthTimeout: params.handleAuthTimeout,

    // Editor dialog
    openEditorDialog: params.openEditorDialog,
    handleEditorSelect: params.handleEditorSelect,
    exitEditorDialog: params.exitEditorDialog,

    // Provider dialog
    openProviderDialog: params.openProviderDialog,
    handleProviderSelect: params.handleProviderSelect,
    exitProviderDialog: params.exitProviderDialog,

    // Load profile dialog
    openLoadProfileDialog: params.openLoadProfileDialog,
    handleProfileSelect: params.handleProfileSelect,
    exitLoadProfileDialog: params.exitLoadProfileDialog,

    // Create profile dialog
    openCreateProfileDialog: params.openCreateProfileDialog,
    exitCreateProfileDialog: params.exitCreateProfileDialog,

    // Profile management dialogs
    openProfileListDialog: params.openProfileListDialog,
    closeProfileListDialog: params.closeProfileListDialog,
    viewProfileDetail: params.viewProfileDetail,
    closeProfileDetailDialog: params.closeProfileDetailDialog,
    loadProfileFromDetail: params.loadProfileFromDetail,
    deleteProfileFromDetail: params.deleteProfileFromDetail,
    setProfileAsDefault: params.setProfileAsDefault,
    openProfileEditor: params.openProfileEditor,
    closeProfileEditor: params.closeProfileEditor,
    saveProfileFromEditor: params.saveProfileFromEditor,

    // Tools dialog
    openToolsDialog: params.openToolsDialog,
    handleToolsSelect: params.handleToolsSelect,
    exitToolsDialog: params.exitToolsDialog,

    // Folder trust dialog
    handleFolderTrustSelect: params.handleFolderTrustSelect,

    // Welcome onboarding
    welcomeActions: params.welcomeActions,
    triggerWelcomeAuth: params.triggerWelcomeAuth,

    // Permissions dialog
    openPermissionsDialog: params.openPermissionsDialog,
    closePermissionsDialog: params.closePermissionsDialog,

    // Logging dialog
    openLoggingDialog: params.openLoggingDialog,
    closeLoggingDialog: params.closeLoggingDialog,

    // Subagent dialog
    openSubagentDialog: params.openSubagentDialog,
    closeSubagentDialog: params.closeSubagentDialog,

    // Models dialog
    openModelsDialog: params.openModelsDialog,
    closeModelsDialog: params.closeModelsDialog,

    // Session browser dialog
    openSessionBrowserDialog: params.openSessionBrowserDialog,
    closeSessionBrowserDialog: params.closeSessionBrowserDialog,

    // Workspace migration dialog
    onWorkspaceMigrationDialogOpen: params.onWorkspaceMigrationDialogOpen,
    onWorkspaceMigrationDialogClose: params.onWorkspaceMigrationDialogClose,

    // Privacy notice
    openPrivacyNotice: params.openPrivacyNotice,
    handlePrivacyNoticeExit: params.handlePrivacyNoticeExit,

    // OAuth code dialog
    handleOAuthCodeDialogClose: params.handleOAuthCodeDialogClose,
    handleOAuthCodeSubmit: params.handleOAuthCodeSubmit,

    // Confirmation handlers
    handleConfirmationSelect: params.handleConfirmationSelect,

    // IDE prompt
    handleIdePromptComplete: params.handleIdePromptComplete,

    // Vim
    vimHandleInput: params.vimHandleInput,
    toggleVimEnabled: params.toggleVimEnabled,

    // Slash commands
    handleSlashCommand: params.handleSlashCommand,

    // Memory
    performMemoryRefresh: params.performMemoryRefresh,

    // Display toggles
    setShowErrorDetails: params.setShowErrorDetails,
    setShowToolDescriptions: params.setShowToolDescriptions,
    setConstrainHeight: params.setConstrainHeight,

    // Shell mode
    setShellModeActive: params.setShellModeActive,

    // Escape prompt
    handleEscapePromptChange: params.handleEscapePromptChange,

    // Cancel ongoing request
    cancelOngoingRequest: params.cancelOngoingRequest,

    // Queue error message
    setQueueErrorMessage: params.setQueueErrorMessage,
  };
}
