/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryItem, ConfirmationRequest } from '../../../types.js';
import type { SubagentView } from '../../../components/SubagentManagement/types.js';
import type { ModelsDialogData } from '../../../commands/types.js';
import type { DialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import type { ExtensionUpdateAction } from '../../../state/extensions.js';
import { useShallowMemo } from '../../../hooks/useShallowMemo.js';

type QuitHandler = (messages: HistoryItem[]) => void;

type WelcomeActionsLike = {
  resetAndReopen: () => void;
};

interface UseSlashCommandActionsParams {
  /** Slice B2a: permissions/logging/subagent now live in the DialogStore. */
  dialogs: DialogOpeners;
  openAuthDialog: () => void;
  openThemeDialog: () => void;
  openEditorDialog: () => void;
  openPrivacyNotice: () => void;
  openSettingsDialog: () => void;
  openModelsDialog: (data?: ModelsDialogData) => void;
  openPoliciesDialog: () => void;
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

/** Result type of useSlashCommandActions — all callback properties. */
export interface SlashCommandActions {
  openAuthDialog: () => void;
  openThemeDialog: () => void;
  openEditorDialog: () => void;
  openPrivacyNotice: () => void;
  openSettingsDialog: () => void;
  openModelsDialog: (data?: ModelsDialogData) => void;
  openPoliciesDialog: () => void;
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
  quit: QuitHandler;
  setDebugMessage: (message: string) => void;
  toggleCorgiMode: () => void;
  toggleDebugProfiler: () => void;
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void;
  addConfirmUpdateExtensionRequest: (request: ConfirmationRequest) => void;
  openWelcomeDialog: () => void;
  openSessionBrowserDialog: () => void;

  // Slice B2a: permissions/logging/subagent route through the DialogStore.
  openPermissionsDialog: () => void;
  closePermissionsDialog: () => void;
  openLoggingDialog: (data?: { entries: unknown[] }) => void;
  closeLoggingDialog: () => void;
  openSubagentDialog: (data?: {
    initialView?: SubagentView;
    initialName?: string;
  }) => void;
  closeSubagentDialog: () => void;
}

function buildActions(p: UseSlashCommandActionsParams): SlashCommandActions {
  const { quitHandler, welcomeActions, dialogs, ...rest } = p;
  return {
    ...rest,
    quit: quitHandler,
    openWelcomeDialog: welcomeActions.resetAndReopen,

    // Slice B2a: store-backed handles.
    openPermissionsDialog: () => dialogs.permissions.open({}),
    closePermissionsDialog: () => dialogs.permissions.close(),
    openLoggingDialog: (data?: { entries: unknown[] }) =>
      dialogs.logging.open(data ?? { entries: [] }),
    closeLoggingDialog: () => dialogs.logging.close(),
    openSubagentDialog: (data?: {
      initialView?: SubagentView;
      initialName?: string;
    }) => dialogs.subagent.open(data ?? {}),
    closeSubagentDialog: () => dialogs.subagent.close(),
  };
}

/**
 * @hook useSlashCommandActions
 * @description Builds action object consumed by useSlashCommandProcessor
 * @inputs Dialog/action callbacks used by slash command processor
 * @outputs Stable slash command actions object
 */
export function useSlashCommandActions(
  p: UseSlashCommandActionsParams,
): SlashCommandActions {
  return useShallowMemo(() => buildActions(p), p);
}
