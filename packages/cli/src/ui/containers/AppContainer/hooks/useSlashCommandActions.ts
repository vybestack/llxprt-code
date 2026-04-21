/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import type { HistoryItem, ConfirmationRequest } from '../../../types.js';
import type { SubagentView } from '../../../components/SubagentManagement/types.js';
import type { ExtensionUpdateAction } from '../../../state/extensions.js';
import type { ModelsDialogData } from '../../../commands/types.js';

type QuitHandler = (messages: HistoryItem[]) => void;

type WelcomeActionsLike = {
  resetAndReopen: () => void;
};

interface UseSlashCommandActionsParams {
  openAuthDialog: () => void;
  openThemeDialog: () => void;
  openEditorDialog: () => void;
  openPrivacyNotice: () => void;
  openSettingsDialog: () => void;
  openLoggingDialog: (data?: { entries: unknown[] }) => void;
  openSubagentDialog: (
    initialView?: SubagentView,
    initialName?: string,
  ) => void;
  openModelsDialog: (data?: ModelsDialogData) => void;
  openPermissionsDialog: () => void;
  openProviderDialog: () => void;
  openLoadProfileDialog: () => void | Promise<void>;
  openCreateProfileDialog: () => void;
  openProfileListDialog: () => void | Promise<void>;
  viewProfileDetail: (
    profileName: string,
    openedDirectly?: boolean,
  ) => void | Promise<void>;
  openProfileEditor: (
    profileName: string,
    openedDirectly?: boolean,
  ) => void | Promise<void>;
  quitHandler: QuitHandler;
  setDebugMessage: (message: string) => void;
  toggleCorgiMode: () => void;
  toggleDebugProfiler: () => void;
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void;
  addConfirmUpdateExtensionRequest: (request: ConfirmationRequest) => void;
  welcomeActions: WelcomeActionsLike;
  openSessionBrowserDialog: () => void;
}

/**
 * @hook useSlashCommandActions
 * @description Builds action object consumed by useSlashCommandProcessor
 * @inputs Dialog/action callbacks used by slash command processor
 * @outputs Stable slash command actions object
 */
export function useSlashCommandActions({
  openAuthDialog,
  openThemeDialog,
  openEditorDialog,
  openPrivacyNotice,
  openSettingsDialog,
  openLoggingDialog,
  openSubagentDialog,
  openModelsDialog,
  openPermissionsDialog,
  openProviderDialog,
  openLoadProfileDialog,
  openCreateProfileDialog,
  openProfileListDialog,
  viewProfileDetail,
  openProfileEditor,
  quitHandler,
  setDebugMessage,
  toggleCorgiMode,
  toggleDebugProfiler,
  dispatchExtensionStateUpdate,
  addConfirmUpdateExtensionRequest,
  welcomeActions,
  openSessionBrowserDialog,
}: UseSlashCommandActionsParams) {
  return useMemo(
    () => ({
      openAuthDialog,
      openThemeDialog,
      openEditorDialog,
      openPrivacyNotice,
      openSettingsDialog,
      openLoggingDialog,
      openSubagentDialog,
      openModelsDialog,
      openPermissionsDialog,
      openProviderDialog,
      openLoadProfileDialog,
      openCreateProfileDialog,
      openProfileListDialog,
      viewProfileDetail,
      openProfileEditor,
      quit: quitHandler,
      setDebugMessage,
      toggleCorgiMode,
      toggleDebugProfiler,
      dispatchExtensionStateUpdate,
      addConfirmUpdateExtensionRequest,
      openWelcomeDialog: welcomeActions.resetAndReopen,
      openSessionBrowserDialog,
    }),
    [
      openAuthDialog,
      openThemeDialog,
      openEditorDialog,
      openPrivacyNotice,
      openSettingsDialog,
      openLoggingDialog,
      openSubagentDialog,
      openModelsDialog,
      openPermissionsDialog,
      openProviderDialog,
      openLoadProfileDialog,
      openCreateProfileDialog,
      openProfileListDialog,
      viewProfileDetail,
      openProfileEditor,
      quitHandler,
      setDebugMessage,
      toggleCorgiMode,
      toggleDebugProfiler,
      dispatchExtensionStateUpdate,
      addConfirmUpdateExtensionRequest,
      welcomeActions,
      openSessionBrowserDialog,
    ],
  );
}
