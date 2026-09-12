/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AppCommandBindings,
  AppCommandData,
  AppCommands,
} from '../ui/contexts/AppCommandsContext.js';

/**
 * Builds complete bindings that reject unexpected command dispatches.
 * @param consumer Component name included in unexpected-dispatch failures.
 * @param data Real input data consumed by the component.
 * @param overrides Commands intentionally exercised by the test.
 * @returns Typed bindings with fail-fast defaults for every command.
 */
export function createAppCommandBindings(
  consumer: string,
  data: AppCommandData,
  overrides: Partial<AppCommands> = {},
): AppCommandBindings {
  const unusedCommand = (): never => {
    throw new Error(`${consumer} must not invoke app commands`);
  };
  return {
    ...data,
    handleUserInputSubmit: unusedCommand,
    handleSteer: unusedCommand,
    handleClearScreen: unusedCommand,
    vimHandleInput: unusedCommand,
    sendAllQueuedSubmissions: unusedCommand,
    steerAllQueuedSubmissions: unusedCommand,
    clearQueuedSubmissions: unusedCommand,
    setShellModeActive: unusedCommand,
    handleEscapePromptChange: unusedCommand,
    setQueueErrorMessage: unusedCommand,
    onWorkspaceMigrationDialogOpen: unusedCommand,
    handleIdePromptComplete: unusedCommand,
    handleFolderTrustSelect: unusedCommand,
    welcomeActions: {
      startSetup: unusedCommand,
      selectProvider: unusedCommand,
      selectModel: unusedCommand,
      selectAuthMethod: unusedCommand,
      onAuthComplete: unusedCommand,
      onAuthError: unusedCommand,
      skipSetup: unusedCommand,
      goBack: unusedCommand,
      saveProfile: unusedCommand,
      dismiss: unusedCommand,
      resetAndReopen: unusedCommand,
    },
    triggerWelcomeAuth: unusedCommand,
    handleThemeSelect: unusedCommand,
    handleThemeHighlight: unusedCommand,
    handleAuthSelect: unusedCommand,
    handleOAuthCodeDialogClose: unusedCommand,
    handleOAuthCodeSubmit: unusedCommand,
    handleEditorSelect: unusedCommand,
    handleProviderSelect: unusedCommand,
    handleProfileSelect: unusedCommand,
    viewProfileDetail: unusedCommand,
    closeProfileDetailDialog: unusedCommand,
    loadProfileFromDetail: unusedCommand,
    deleteProfileFromDetail: unusedCommand,
    deleteProfileFromList: unusedCommand,
    setProfileAsDefault: unusedCommand,
    openProfileEditor: unusedCommand,
    closeProfileEditor: unusedCommand,
    saveProfileFromEditor: unusedCommand,
    handleToolsSelect: unusedCommand,
    handleSettingsRestart: unusedCommand,
    ...overrides,
  };
}
