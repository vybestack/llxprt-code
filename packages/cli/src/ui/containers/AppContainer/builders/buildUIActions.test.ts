/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { buildUIActions, type UIActionsParams } from './buildUIActions.js';

const makeParams = (): UIActionsParams => ({
  // History actions
  addItem: vi.fn(),
  clearItems: vi.fn(),
  loadHistory: vi.fn(),
  refreshStatic: vi.fn(),

  // Input actions
  handleUserInputSubmit: vi.fn(),
  handleSteer: vi.fn(),
  handleClearScreen: vi.fn(),

  handleThemeSelect: vi.fn(),
  handleThemeHighlight: vi.fn(),

  // Settings dialog
  handleSettingsRestart: vi.fn(),

  // Auth dialog
  handleAuthSelect: vi.fn(),
  handleAuthTimeout: vi.fn(),

  // Editor dialog
  handleEditorSelect: vi.fn(),

  // Provider dialog
  handleProviderSelect: vi.fn(),

  // Load profile dialog
  handleProfileSelect: vi.fn(),

  // Profile management dialogs
  viewProfileDetail: vi.fn(),
  closeProfileDetailDialog: vi.fn(),
  loadProfileFromDetail: vi.fn(),
  deleteProfileFromDetail: vi.fn(),
  deleteProfileFromList: vi.fn(),
  setProfileAsDefault: vi.fn(),
  openProfileEditor: vi.fn(),
  closeProfileEditor: vi.fn(),
  saveProfileFromEditor: vi.fn(),

  // Tools dialog
  handleToolsSelect: vi.fn(),

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

  // Workspace migration dialog (open/close state lives in DialogStore)
  onWorkspaceMigrationDialogOpen: vi.fn(),

  // OAuth code dialog
  handleOAuthCodeDialogClose: vi.fn(),
  handleOAuthCodeSubmit: vi.fn(),

  // IDE prompt
  handleIdePromptComplete: vi.fn(),

  // Vim
  vimHandleInput: vi.fn(),
  toggleVimEnabled: vi.fn(),

  // Slash commands
  handleSlashCommand: vi.fn(),

  // Memory
  performMemoryRefresh: vi.fn(),

  // Shell mode
  setShellModeActive: vi.fn(),

  // Escape prompt
  handleEscapePromptChange: vi.fn(),

  // Cancel ongoing request
  cancelOngoingRequest: vi.fn(),

  // Queue actions (issue #2882)
  setQueueErrorMessage: vi.fn(),
  sendAllQueuedSubmissions: vi.fn(),
  steerAllQueuedSubmissions: vi.fn(),
  clearQueuedSubmissions: vi.fn(),
});

describe('buildUIActions', () => {
  it('produces an object containing every UIActions key', () => {
    const result = buildUIActions(makeParams());

    expect(result.addItem).toBeDefined();
    expect(result.clearItems).toBeDefined();
    expect(result.loadHistory).toBeDefined();
    expect(result.refreshStatic).toBeDefined();
    expect(result.handleUserInputSubmit).toBeDefined();
    expect(result.handleSteer).toBeDefined();
    expect(result.handleClearScreen).toBeDefined();
    expect(result.handleThemeSelect).toBeDefined();
    expect(result.handleThemeHighlight).toBeDefined();
    expect(result.handleSettingsRestart).toBeDefined();
    expect(result.handleAuthSelect).toBeDefined();
    expect(result.handleAuthTimeout).toBeDefined();
    expect(result.handleEditorSelect).toBeDefined();
    expect(result.handleProviderSelect).toBeDefined();
    expect(result.handleProfileSelect).toBeDefined();
    expect(result.viewProfileDetail).toBeDefined();
    expect(result.closeProfileDetailDialog).toBeDefined();
    expect(result.loadProfileFromDetail).toBeDefined();
    expect(result.deleteProfileFromDetail).toBeDefined();
    expect(result.deleteProfileFromList).toBeDefined();
    expect(result.setProfileAsDefault).toBeDefined();
    expect(result.openProfileEditor).toBeDefined();
    expect(result.closeProfileEditor).toBeDefined();
    expect(result.saveProfileFromEditor).toBeDefined();
    expect(result.handleToolsSelect).toBeDefined();
    expect(result.handleFolderTrustSelect).toBeDefined();
    expect(result.welcomeActions).toBeDefined();
    expect(result.triggerWelcomeAuth).toBeDefined();
    expect(result.onWorkspaceMigrationDialogOpen).toBeDefined();
    expect(result.handleOAuthCodeDialogClose).toBeDefined();
    expect(result.handleOAuthCodeSubmit).toBeDefined();
    expect(result.handleIdePromptComplete).toBeDefined();
    expect(result.vimHandleInput).toBeDefined();
    expect(result.toggleVimEnabled).toBeDefined();
    expect(result.handleSlashCommand).toBeDefined();
    expect(result.performMemoryRefresh).toBeDefined();
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
    expect(result.handleSteer).toBe(params.handleSteer);
    expect(result.handleClearScreen).toBe(params.handleClearScreen);
    expect(result.handleThemeSelect).toBe(params.handleThemeSelect);
    expect(result.handleThemeHighlight).toBe(params.handleThemeHighlight);
    expect(result.handleSettingsRestart).toBe(params.handleSettingsRestart);
    expect(result.handleAuthSelect).toBe(params.handleAuthSelect);
    expect(result.handleAuthTimeout).toBe(params.handleAuthTimeout);
    expect(result.handleEditorSelect).toBe(params.handleEditorSelect);
    expect(result.handleProviderSelect).toBe(params.handleProviderSelect);
    expect(result.handleProfileSelect).toBe(params.handleProfileSelect);
    expect(result.viewProfileDetail).toBe(params.viewProfileDetail);
    expect(result.closeProfileDetailDialog).toBe(
      params.closeProfileDetailDialog,
    );
    expect(result.loadProfileFromDetail).toBe(params.loadProfileFromDetail);
    expect(result.deleteProfileFromDetail).toBe(params.deleteProfileFromDetail);
    expect(result.deleteProfileFromList).toBe(params.deleteProfileFromList);
    expect(result.setProfileAsDefault).toBe(params.setProfileAsDefault);
    expect(result.openProfileEditor).toBe(params.openProfileEditor);
    expect(result.closeProfileEditor).toBe(params.closeProfileEditor);
    expect(result.saveProfileFromEditor).toBe(params.saveProfileFromEditor);
    expect(result.handleToolsSelect).toBe(params.handleToolsSelect);
    expect(result.handleFolderTrustSelect).toBe(params.handleFolderTrustSelect);
    expect(result.welcomeActions).toBe(params.welcomeActions);
    expect(result.triggerWelcomeAuth).toBe(params.triggerWelcomeAuth);
    expect(result.onWorkspaceMigrationDialogOpen).toBe(
      params.onWorkspaceMigrationDialogOpen,
    );
    expect(result.handleOAuthCodeDialogClose).toBe(
      params.handleOAuthCodeDialogClose,
    );
    expect(result.handleOAuthCodeSubmit).toBe(params.handleOAuthCodeSubmit);
    expect(result.handleIdePromptComplete).toBe(params.handleIdePromptComplete);
    expect(result.vimHandleInput).toBe(params.vimHandleInput);
    expect(result.toggleVimEnabled).toBe(params.toggleVimEnabled);
    expect(result.handleSlashCommand).toBe(params.handleSlashCommand);
    expect(result.performMemoryRefresh).toBe(params.performMemoryRefresh);
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
