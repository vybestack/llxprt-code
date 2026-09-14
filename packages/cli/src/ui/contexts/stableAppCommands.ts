/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RefObject } from 'react';
import type { AppCommands } from './AppCommandsContext.js';

type CommandRef = RefObject<AppCommands>;

function createWelcomeCommands(
  latest: CommandRef,
): AppCommands['welcomeActions'] {
  return {
    startSetup: (...args) => latest.current.welcomeActions.startSetup(...args),
    selectProvider: (...args) =>
      latest.current.welcomeActions.selectProvider(...args),
    selectModel: (...args) =>
      latest.current.welcomeActions.selectModel(...args),
    selectAuthMethod: (...args) =>
      latest.current.welcomeActions.selectAuthMethod(...args),
    onAuthComplete: (...args) =>
      latest.current.welcomeActions.onAuthComplete(...args),
    onAuthError: (...args) =>
      latest.current.welcomeActions.onAuthError(...args),
    skipSetup: (...args) => latest.current.welcomeActions.skipSetup(...args),
    goBack: (...args) => latest.current.welcomeActions.goBack(...args),
    saveProfile: (...args) =>
      latest.current.welcomeActions.saveProfile(...args),
    dismiss: (...args) => latest.current.welcomeActions.dismiss(...args),
    resetAndReopen: (...args) =>
      latest.current.welcomeActions.resetAndReopen(...args),
  };
}

/**
 * Binds the view command surface for the available capabilities. Each invocation
 * reads the current handler from the latest render of its owning hook.
 * @param latest Reference maintained by the command provider.
 * @param capabilities Optional queue commands available in this render.
 * @returns Stable callbacks, including the nested onboarding commands.
 */
export function createStableAppCommands(
  latest: CommandRef,
  capabilities: { canSendQueued: boolean; canSteerQueued: boolean },
): AppCommands {
  return {
    welcomeActions: createWelcomeCommands(latest),
    handleUserInputSubmit: (...args) =>
      latest.current.handleUserInputSubmit(...args),
    handleSteer: (...args) => latest.current.handleSteer(...args),
    handleClearScreen: (...args) => latest.current.handleClearScreen(...args),
    vimHandleInput: (...args) => latest.current.vimHandleInput(...args),
    sendAllQueuedSubmissions: capabilities.canSendQueued
      ? (...args) => latest.current.sendAllQueuedSubmissions?.(...args)
      : undefined,
    steerAllQueuedSubmissions: capabilities.canSteerQueued
      ? (...args) => latest.current.steerAllQueuedSubmissions?.(...args)
      : undefined,
    clearQueuedSubmissions: (...args) =>
      latest.current.clearQueuedSubmissions(...args),
    setShellModeActive: (...args) => latest.current.setShellModeActive(...args),
    handleEscapePromptChange: (...args) =>
      latest.current.handleEscapePromptChange(...args),
    setQueueErrorMessage: (...args) =>
      latest.current.setQueueErrorMessage(...args),
    onWorkspaceMigrationDialogOpen: (...args) =>
      latest.current.onWorkspaceMigrationDialogOpen(...args),
    handleIdePromptComplete: (...args) =>
      latest.current.handleIdePromptComplete(...args),
    handleFolderTrustSelect: (...args) =>
      latest.current.handleFolderTrustSelect(...args),
    triggerWelcomeAuth: (...args) => latest.current.triggerWelcomeAuth(...args),
    handleThemeSelect: (...args) => latest.current.handleThemeSelect(...args),
    handleThemeHighlight: (...args) =>
      latest.current.handleThemeHighlight(...args),
    handleAuthSelect: (...args) => latest.current.handleAuthSelect(...args),
    handleOAuthCodeDialogClose: (...args) =>
      latest.current.handleOAuthCodeDialogClose(...args),
    handleOAuthCodeSubmit: (...args) =>
      latest.current.handleOAuthCodeSubmit(...args),
    handleEditorSelect: (...args) => latest.current.handleEditorSelect(...args),
    handleProviderSelect: (...args) =>
      latest.current.handleProviderSelect(...args),
    handleProfileSelect: (...args) =>
      latest.current.handleProfileSelect(...args),
    viewProfileDetail: (...args) => latest.current.viewProfileDetail(...args),
    closeProfileDetailDialog: (...args) =>
      latest.current.closeProfileDetailDialog(...args),
    loadProfileFromDetail: (...args) =>
      latest.current.loadProfileFromDetail(...args),
    deleteProfileFromDetail: (...args) =>
      latest.current.deleteProfileFromDetail(...args),
    deleteProfileFromList: (...args) =>
      latest.current.deleteProfileFromList(...args),
    setProfileAsDefault: (...args) =>
      latest.current.setProfileAsDefault(...args),
    openProfileEditor: (...args) => latest.current.openProfileEditor(...args),
    closeProfileEditor: (...args) => latest.current.closeProfileEditor(...args),
    saveProfileFromEditor: (...args) =>
      latest.current.saveProfileFromEditor(...args),
    handleToolsSelect: (...args) => latest.current.handleToolsSelect(...args),
    handleSettingsRestart: (...args) =>
      latest.current.handleSettingsRestart(...args),
  };
}
