/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { buildUIActions, type UIActionsParams } from './buildUIActions.js';

const makeParams = (): UIActionsParams => ({
  // History actions
  addItem: vi.fn(),
  clearItems: vi.fn(),
  loadHistory: vi.fn(),
  refreshStatic: vi.fn(),

  // Input actions
  handleUserInputSubmit: vi.fn(),
  handleClearScreen: vi.fn(),

  // Theme dialog
  openThemeDialog: vi.fn(),
  handleThemeSelect: vi.fn(),
  handleThemeHighlight: vi.fn(),

  // Settings dialog
  openSettingsDialog: vi.fn(),
  closeSettingsDialog: vi.fn(),
  handleSettingsRestart: vi.fn(),

  // Auth dialog
  openAuthDialog: vi.fn(),
  handleAuthSelect: vi.fn(),
  handleAuthTimeout: vi.fn(),

  // Editor dialog
  openEditorDialog: vi.fn(),
  handleEditorSelect: vi.fn(),
  exitEditorDialog: vi.fn(),

  // Provider dialog
  openProviderDialog: vi.fn(),
  handleProviderSelect: vi.fn(),
  exitProviderDialog: vi.fn(),

  // Load profile dialog
  openLoadProfileDialog: vi.fn(),
  handleProfileSelect: vi.fn(),
  exitLoadProfileDialog: vi.fn(),

  // Create profile dialog
  openCreateProfileDialog: vi.fn(),
  exitCreateProfileDialog: vi.fn(),

  // Profile management dialogs
  openProfileListDialog: vi.fn(),
  closeProfileListDialog: vi.fn(),
  viewProfileDetail: vi.fn(),
  closeProfileDetailDialog: vi.fn(),
  loadProfileFromDetail: vi.fn(),
  deleteProfileFromDetail: vi.fn(),
  setProfileAsDefault: vi.fn(),
  openProfileEditor: vi.fn(),
  closeProfileEditor: vi.fn(),
  saveProfileFromEditor: vi.fn(),

  // Tools dialog
  openToolsDialog: vi.fn(),
  handleToolsSelect: vi.fn(),
  exitToolsDialog: vi.fn(),

  // Folder trust dialog
  handleFolderTrustSelect: vi.fn(),

  // Welcome onboarding
  welcomeActions: {
    startSetup: vi.fn(),
    selectProvider: vi.fn(),
    selectModel: vi.fn(),
    selectAuthMethod: vi.fn(),
    onAuthComplete: vi.fn(),
    onAuthError: vi.fn(),
    skipSetup: vi.fn(),
    goBack: vi.fn(),
    saveProfile: vi.fn(),
    dismiss: vi.fn(),
    resetAndReopen: vi.fn(),
  },
  triggerWelcomeAuth: vi.fn(),

  // Permissions dialog
  openPermissionsDialog: vi.fn(),
  closePermissionsDialog: vi.fn(),

  // Logging dialog
  openLoggingDialog: vi.fn(),
  closeLoggingDialog: vi.fn(),

  // Subagent dialog
  openSubagentDialog: vi.fn(),
  closeSubagentDialog: vi.fn(),

  // Models dialog
  openModelsDialog: vi.fn(),
  closeModelsDialog: vi.fn(),

  // Session browser dialog
  openSessionBrowserDialog: vi.fn(),
  closeSessionBrowserDialog: vi.fn(),

  // Workspace migration dialog
  onWorkspaceMigrationDialogOpen: vi.fn(),
  onWorkspaceMigrationDialogClose: vi.fn(),

  // Privacy notice
  openPrivacyNotice: vi.fn(),
  handlePrivacyNoticeExit: vi.fn(),

  // OAuth code dialog
  handleOAuthCodeDialogClose: vi.fn(),
  handleOAuthCodeSubmit: vi.fn(),

  // Confirmation handlers
  handleConfirmationSelect: vi.fn(),

  // IDE prompt
  handleIdePromptComplete: vi.fn(),

  // Vim
  vimHandleInput: vi.fn(),
  toggleVimEnabled: vi.fn(),

  // Slash commands
  handleSlashCommand: vi.fn(),

  // Memory
  performMemoryRefresh: vi.fn(),

  // Display toggles
  setShowErrorDetails: vi.fn(),
  setShowToolDescriptions: vi.fn(),
  setConstrainHeight: vi.fn(),

  // Shell mode
  setShellModeActive: vi.fn(),

  // Escape prompt
  handleEscapePromptChange: vi.fn(),

  // Cancel ongoing request
  cancelOngoingRequest: vi.fn(),

  // Queue error message
  setQueueErrorMessage: vi.fn(),
});

describe('buildUIActions', () => {
  it('produces an object containing every UIActions key', () => {
    const params = makeParams();
    const result = buildUIActions(params);

    expect(result.addItem).toBeDefined();
    expect(result.clearItems).toBeDefined();
    expect(result.loadHistory).toBeDefined();
    expect(result.refreshStatic).toBeDefined();
    expect(result.handleUserInputSubmit).toBeDefined();
    expect(result.handleClearScreen).toBeDefined();
    expect(result.openThemeDialog).toBeDefined();
    expect(result.handleThemeSelect).toBeDefined();
    expect(result.handleThemeHighlight).toBeDefined();
    expect(result.openSettingsDialog).toBeDefined();
    expect(result.closeSettingsDialog).toBeDefined();
    expect(result.handleSettingsRestart).toBeDefined();
    expect(result.openAuthDialog).toBeDefined();
    expect(result.handleAuthSelect).toBeDefined();
    expect(result.handleAuthTimeout).toBeDefined();
    expect(result.openEditorDialog).toBeDefined();
    expect(result.handleEditorSelect).toBeDefined();
    expect(result.exitEditorDialog).toBeDefined();
    expect(result.openProviderDialog).toBeDefined();
    expect(result.handleProviderSelect).toBeDefined();
    expect(result.exitProviderDialog).toBeDefined();
    expect(result.openLoadProfileDialog).toBeDefined();
    expect(result.handleProfileSelect).toBeDefined();
    expect(result.exitLoadProfileDialog).toBeDefined();
    expect(result.openCreateProfileDialog).toBeDefined();
    expect(result.exitCreateProfileDialog).toBeDefined();
    expect(result.openProfileListDialog).toBeDefined();
    expect(result.closeProfileListDialog).toBeDefined();
    expect(result.viewProfileDetail).toBeDefined();
    expect(result.closeProfileDetailDialog).toBeDefined();
    expect(result.loadProfileFromDetail).toBeDefined();
    expect(result.deleteProfileFromDetail).toBeDefined();
    expect(result.setProfileAsDefault).toBeDefined();
    expect(result.openProfileEditor).toBeDefined();
    expect(result.closeProfileEditor).toBeDefined();
    expect(result.saveProfileFromEditor).toBeDefined();
    expect(result.openToolsDialog).toBeDefined();
    expect(result.handleToolsSelect).toBeDefined();
    expect(result.exitToolsDialog).toBeDefined();
    expect(result.handleFolderTrustSelect).toBeDefined();
    expect(result.welcomeActions).toBeDefined();
    expect(result.triggerWelcomeAuth).toBeDefined();
    expect(result.openPermissionsDialog).toBeDefined();
    expect(result.closePermissionsDialog).toBeDefined();
    expect(result.openLoggingDialog).toBeDefined();
    expect(result.closeLoggingDialog).toBeDefined();
    expect(result.openSubagentDialog).toBeDefined();
    expect(result.closeSubagentDialog).toBeDefined();
    expect(result.openModelsDialog).toBeDefined();
    expect(result.closeModelsDialog).toBeDefined();
    expect(result.openSessionBrowserDialog).toBeDefined();
    expect(result.closeSessionBrowserDialog).toBeDefined();
    expect(result.onWorkspaceMigrationDialogOpen).toBeDefined();
    expect(result.onWorkspaceMigrationDialogClose).toBeDefined();
    expect(result.openPrivacyNotice).toBeDefined();
    expect(result.handlePrivacyNoticeExit).toBeDefined();
    expect(result.handleOAuthCodeDialogClose).toBeDefined();
    expect(result.handleOAuthCodeSubmit).toBeDefined();
    expect(result.handleConfirmationSelect).toBeDefined();
    expect(result.handleIdePromptComplete).toBeDefined();
    expect(result.vimHandleInput).toBeDefined();
    expect(result.toggleVimEnabled).toBeDefined();
    expect(result.handleSlashCommand).toBeDefined();
    expect(result.performMemoryRefresh).toBeDefined();
    expect(result.setShowErrorDetails).toBeDefined();
    expect(result.setShowToolDescriptions).toBeDefined();
    expect(result.setConstrainHeight).toBeDefined();
    expect(result.setShellModeActive).toBeDefined();
    expect(result.handleEscapePromptChange).toBeDefined();
    expect(result.cancelOngoingRequest).toBeDefined();
    expect(result.setQueueErrorMessage).toBeDefined();
  });

  it('passes through all callback references unchanged', () => {
    const params = makeParams();
    const result = buildUIActions(params);

    expect(result.addItem).toBe(params.addItem);
    expect(result.clearItems).toBe(params.clearItems);
    expect(result.loadHistory).toBe(params.loadHistory);
    expect(result.refreshStatic).toBe(params.refreshStatic);
    expect(result.handleUserInputSubmit).toBe(params.handleUserInputSubmit);
    expect(result.handleClearScreen).toBe(params.handleClearScreen);
    expect(result.openThemeDialog).toBe(params.openThemeDialog);
    expect(result.handleThemeSelect).toBe(params.handleThemeSelect);
    expect(result.handleThemeHighlight).toBe(params.handleThemeHighlight);
    expect(result.openSettingsDialog).toBe(params.openSettingsDialog);
    expect(result.closeSettingsDialog).toBe(params.closeSettingsDialog);
    expect(result.handleSettingsRestart).toBe(params.handleSettingsRestart);
    expect(result.openAuthDialog).toBe(params.openAuthDialog);
    expect(result.handleAuthSelect).toBe(params.handleAuthSelect);
    expect(result.handleAuthTimeout).toBe(params.handleAuthTimeout);
    expect(result.openEditorDialog).toBe(params.openEditorDialog);
    expect(result.handleEditorSelect).toBe(params.handleEditorSelect);
    expect(result.exitEditorDialog).toBe(params.exitEditorDialog);
    expect(result.openProviderDialog).toBe(params.openProviderDialog);
    expect(result.handleProviderSelect).toBe(params.handleProviderSelect);
    expect(result.exitProviderDialog).toBe(params.exitProviderDialog);
    expect(result.openLoadProfileDialog).toBe(params.openLoadProfileDialog);
    expect(result.handleProfileSelect).toBe(params.handleProfileSelect);
    expect(result.exitLoadProfileDialog).toBe(params.exitLoadProfileDialog);
    expect(result.openCreateProfileDialog).toBe(params.openCreateProfileDialog);
    expect(result.exitCreateProfileDialog).toBe(params.exitCreateProfileDialog);
    expect(result.openProfileListDialog).toBe(params.openProfileListDialog);
    expect(result.closeProfileListDialog).toBe(params.closeProfileListDialog);
    expect(result.viewProfileDetail).toBe(params.viewProfileDetail);
    expect(result.closeProfileDetailDialog).toBe(
      params.closeProfileDetailDialog,
    );
    expect(result.loadProfileFromDetail).toBe(params.loadProfileFromDetail);
    expect(result.deleteProfileFromDetail).toBe(params.deleteProfileFromDetail);
    expect(result.setProfileAsDefault).toBe(params.setProfileAsDefault);
    expect(result.openProfileEditor).toBe(params.openProfileEditor);
    expect(result.closeProfileEditor).toBe(params.closeProfileEditor);
    expect(result.saveProfileFromEditor).toBe(params.saveProfileFromEditor);
    expect(result.openToolsDialog).toBe(params.openToolsDialog);
    expect(result.handleToolsSelect).toBe(params.handleToolsSelect);
    expect(result.exitToolsDialog).toBe(params.exitToolsDialog);
    expect(result.handleFolderTrustSelect).toBe(params.handleFolderTrustSelect);
    expect(result.welcomeActions).toBe(params.welcomeActions);
    expect(result.triggerWelcomeAuth).toBe(params.triggerWelcomeAuth);
    expect(result.openPermissionsDialog).toBe(params.openPermissionsDialog);
    expect(result.closePermissionsDialog).toBe(params.closePermissionsDialog);
    expect(result.openLoggingDialog).toBe(params.openLoggingDialog);
    expect(result.closeLoggingDialog).toBe(params.closeLoggingDialog);
    expect(result.openSubagentDialog).toBe(params.openSubagentDialog);
    expect(result.closeSubagentDialog).toBe(params.closeSubagentDialog);
    expect(result.openModelsDialog).toBe(params.openModelsDialog);
    expect(result.closeModelsDialog).toBe(params.closeModelsDialog);
    expect(result.openSessionBrowserDialog).toBe(
      params.openSessionBrowserDialog,
    );
    expect(result.closeSessionBrowserDialog).toBe(
      params.closeSessionBrowserDialog,
    );
    expect(result.onWorkspaceMigrationDialogOpen).toBe(
      params.onWorkspaceMigrationDialogOpen,
    );
    expect(result.onWorkspaceMigrationDialogClose).toBe(
      params.onWorkspaceMigrationDialogClose,
    );
    expect(result.openPrivacyNotice).toBe(params.openPrivacyNotice);
    expect(result.handlePrivacyNoticeExit).toBe(params.handlePrivacyNoticeExit);
    expect(result.handleOAuthCodeDialogClose).toBe(
      params.handleOAuthCodeDialogClose,
    );
    expect(result.handleOAuthCodeSubmit).toBe(params.handleOAuthCodeSubmit);
    expect(result.handleConfirmationSelect).toBe(
      params.handleConfirmationSelect,
    );
    expect(result.handleIdePromptComplete).toBe(params.handleIdePromptComplete);
    expect(result.vimHandleInput).toBe(params.vimHandleInput);
    expect(result.toggleVimEnabled).toBe(params.toggleVimEnabled);
    expect(result.handleSlashCommand).toBe(params.handleSlashCommand);
    expect(result.performMemoryRefresh).toBe(params.performMemoryRefresh);
    expect(result.setShowErrorDetails).toBe(params.setShowErrorDetails);
    expect(result.setShowToolDescriptions).toBe(params.setShowToolDescriptions);
    expect(result.setConstrainHeight).toBe(params.setConstrainHeight);
    expect(result.setShellModeActive).toBe(params.setShellModeActive);
    expect(result.handleEscapePromptChange).toBe(
      params.handleEscapePromptChange,
    );
    expect(result.cancelOngoingRequest).toBe(params.cancelOngoingRequest);
    expect(result.setQueueErrorMessage).toBe(params.setQueueErrorMessage);
  });

  it('output has exactly the known UIActions keys — no extras, no omissions', () => {
    // Include optional cancelOngoingRequest so Object.keys is symmetric
    const params: Parameters<typeof buildUIActions>[0] = {
      ...makeParams(),
      cancelOngoingRequest: undefined,
    };
    const result = buildUIActions(params);
    const actualKeys = Object.keys(result).sort();
    const expectedKeys = Object.keys(params).sort();
    expect(actualKeys).toStrictEqual(expectedKeys);
  });
});
