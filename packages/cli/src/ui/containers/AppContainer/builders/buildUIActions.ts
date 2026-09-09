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
  welcomeActions: UIActions['welcomeActions'];
  triggerWelcomeAuth: (
    provider: string,
    method: 'oauth' | 'api_key',
    apiKey?: string,
  ) => Promise<void>;

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

  // Model config dialog
  openModelConfigDialog: () => void;
  closeModelConfigDialog: () => void;

  // Policies dialog
  openPoliciesDialog: () => void;
  closePoliciesDialog: () => void;

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

  // Queued messages actions (issue #2882)
  sendAllQueuedSubmissions?: () => void;
  steerAllQueuedSubmissions?: () => void;
  clearQueuedSubmissions?: () => void;
}

function queueActions(p: UIActionsParams) {
  return {
    setQueueErrorMessage: p.setQueueErrorMessage,
    sendAllQueuedSubmissions: p.sendAllQueuedSubmissions,
    steerAllQueuedSubmissions: p.steerAllQueuedSubmissions,
    clearQueuedSubmissions: p.clearQueuedSubmissions,
  };
}

function policiesActions(p: UIActionsParams) {
  return {
    openPoliciesDialog: p.openPoliciesDialog,
    closePoliciesDialog: p.closePoliciesDialog,
  };
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
    handleSteer: params.handleSteer,
    handleClearScreen: params.handleClearScreen,

    // Theme dialog
    handleThemeSelect: params.handleThemeSelect,
    handleThemeHighlight: params.handleThemeHighlight,

    // Settings dialog
    handleSettingsRestart: params.handleSettingsRestart,

    // Auth dialog
    handleAuthSelect: params.handleAuthSelect,
    handleAuthTimeout: params.handleAuthTimeout,

    // Editor dialog
    handleEditorSelect: params.handleEditorSelect,

    // Provider dialog
    handleProviderSelect: params.handleProviderSelect,

    // Load profile dialog
    handleProfileSelect: params.handleProfileSelect,

    // Profile management dialogs
    viewProfileDetail: params.viewProfileDetail,
    closeProfileDetailDialog: params.closeProfileDetailDialog,
    loadProfileFromDetail: params.loadProfileFromDetail,
    deleteProfileFromDetail: params.deleteProfileFromDetail,
    deleteProfileFromList: params.deleteProfileFromList,
    setProfileAsDefault: params.setProfileAsDefault,
    openProfileEditor: params.openProfileEditor,
    closeProfileEditor: params.closeProfileEditor,
    saveProfileFromEditor: params.saveProfileFromEditor,

    // Tools dialog
    handleToolsSelect: params.handleToolsSelect,

    // Folder trust dialog
    handleFolderTrustSelect: params.handleFolderTrustSelect,

    // Welcome onboarding
    welcomeActions: params.welcomeActions,
    triggerWelcomeAuth: params.triggerWelcomeAuth,

    // Models dialog
    openModelsDialog: params.openModelsDialog,
    closeModelsDialog: params.closeModelsDialog,

    // Model config dialog
    openModelConfigDialog: params.openModelConfigDialog,
    closeModelConfigDialog: params.closeModelConfigDialog,

    ...policiesActions(params),

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

    ...queueActions(params),
  };
}
