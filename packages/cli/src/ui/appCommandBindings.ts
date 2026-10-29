/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type {
  AppCommands,
  AppCommandBindings,
} from './contexts/AppCommandsContext.js';
import type { AppDialogsResult } from './containers/AppContainer/hooks/useAppDialogs.js';
import type { AppInputResult } from './containers/AppContainer/hooks/useAppInput.js';
import type { AppLayoutResult } from './containers/AppContainer/hooks/useAppLayout.js';
import type { TerminalStore } from './stores/terminal/terminalStore.js';
/**
 * Current domain bindings, including changing input snapshots. The provider
 * separates these snapshots from the stable view-facing command callbacks.
 */
function subagentDialogCommands(
  dialogs: Pick<
    AppCommands,
    | 'listSubagentDefinitions'
    | 'loadSubagentDefinition'
    | 'saveSubagentDefinition'
    | 'deleteSubagentDefinition'
    | 'listSubagentProfiles'
    | 'generateSubagentPrompt'
  >,
) {
  return {
    listSubagentDefinitions: dialogs.listSubagentDefinitions,
    loadSubagentDefinition: dialogs.loadSubagentDefinition,
    saveSubagentDefinition: dialogs.saveSubagentDefinition,
    deleteSubagentDefinition: dialogs.deleteSubagentDefinition,
    listSubagentProfiles: dialogs.listSubagentProfiles,
    generateSubagentPrompt: dialogs.generateSubagentPrompt,
  };
}

type DialogViewCommands = Pick<
  AppDialogsResult,
  keyof AppCommandBindings & keyof AppDialogsResult
>;

export function buildAppCommands(
  dialogs: DialogViewCommands,
  input: Pick<
    AppInputResult,
    keyof AppCommandBindings & keyof AppInputResult
  > & {
    inputHistoryStore: Pick<
      AppInputResult['inputHistoryStore'],
      'inputHistory'
    >;
  },
  layout: Pick<AppLayoutResult, 'handleClearScreen'>,
  terminalStore: TerminalStore,
): AppCommandBindings {
  const { commands: terminalCommands } = terminalStore;
  return {
    buffer: input.buffer,
    commandContext: input.commandContext,
    generatePromptContent: input.generatePromptContent,
    inputHistory: input.inputHistoryStore.inputHistory,
    handleUserInputSubmit: input.handleUserInputSubmit,
    handleSteer: input.handleSteer,
    handleClearScreen: layout.handleClearScreen,
    vimHandleInput: input.vimHandleInput,
    sendAllQueuedSubmissions: input.sendAllQueuedSubmissions,
    steerAllQueuedSubmissions: input.steerAllQueuedSubmissions,
    clearQueuedSubmissions: input.clearQueuedSubmissions,
    setShellModeActive: terminalCommands.setShellModeActive,
    handleEscapePromptChange: terminalCommands.setShowEscapePrompt,
    setQueueErrorMessage: terminalCommands.setQueueErrorMessage,
    onWorkspaceMigrationDialogOpen: dialogs.onWorkspaceMigrationDialogOpen,
    handleIdePromptComplete: input.handleIdePromptComplete,
    handleFolderTrustSelect: dialogs.handleFolderTrustSelect,
    welcomeActions: dialogs.welcomeActions,
    triggerWelcomeAuth: dialogs.triggerWelcomeAuth,
    resumeBrowserTarget: input.resumeBrowserTarget,
    readBrowserCatalog: input.readBrowserCatalog,
    deleteBrowserTarget: input.deleteBrowserTarget,
    recordModelSwitch: dialogs.recordModelSwitch,
    readPolicyRules: dialogs.readPolicyRules,
    ...subagentDialogCommands(dialogs),
    handleThemeSelect: dialogs.handleThemeSelect,
    handleThemeHighlight: dialogs.handleThemeHighlight,
    handleAuthSelect: dialogs.handleAuthSelect,
    handleOAuthCodeDialogClose: input.handleOAuthCodeDialogClose,
    handleOAuthCodeSubmit: input.handleOAuthCodeSubmit,
    handleEditorSelect: dialogs.handleEditorSelect,
    handleProviderSelect: dialogs.handleProviderSelect,
    handleProfileSelect: (...args) => {
      void dialogs.handleProfileSelect(...args);
    },
    viewProfileDetail: (...args) => {
      void dialogs.viewProfileDetail(...args);
    },
    closeProfileDetailDialog: () => {
      void dialogs.closeProfileDetailDialog();
    },
    loadProfileFromDetail: (...args) => {
      void dialogs.loadProfileFromDetail(...args);
    },
    deleteProfileFromDetail: (...args) => {
      void dialogs.deleteProfileFromDetail(...args);
    },
    deleteProfileFromList: (...args) => {
      void dialogs.deleteProfileFromList(...args);
    },
    setProfileAsDefault: (...args) => {
      void dialogs.setProfileAsDefault(...args);
    },
    openProfileEditor: (...args) => {
      void dialogs.openProfileEditor(...args);
    },
    closeProfileEditor: () => {
      void dialogs.closeProfileEditor();
    },
    saveProfileFromEditor: dialogs.saveProfileFromEditor,
    handleToolsSelect: dialogs.handleToolsSelect,
    handleSettingsRestart: input.handleSettingsRestart,
  };
}

export function useAppCommands(
  dialogs: AppDialogsResult,
  input: AppInputResult,
  layout: AppLayoutResult,
  terminalStore: TerminalStore,
): AppCommandBindings {
  return useMemo(
    () => buildAppCommands(dialogs, input, layout, terminalStore),
    [dialogs, input, layout, terminalStore],
  );
}
