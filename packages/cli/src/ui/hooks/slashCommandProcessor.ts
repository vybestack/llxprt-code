/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HistoryItem, ConfirmationRequest } from '../types.js';
import type { ModelsDialogData } from '../commands/types.js';
import type { ExtensionUpdateAction } from '../state/extensions.js';
import type { SubagentView } from '../components/SubagentManagement/types.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';

export const confirmationLogger = new DebugLogger('llxprt:ui:selection');
export const slashCommandLogger = new DebugLogger('llxprt:ui:slash-commands');

export interface SlashCommandProcessorActions {
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
  openPoliciesDialog: () => void;
  openProviderDialog: () => void;
  openLoadProfileDialog: () => void;
  openCreateProfileDialog: () => void;
  openProfileListDialog: () => void;
  viewProfileDetail: (profileName: string, openedDirectly?: boolean) => void;
  openProfileEditor: (profileName: string, openedDirectly?: boolean) => void;
  quit: (messages: HistoryItem[]) => void;
  setDebugMessage: (message: string) => void;
  toggleCorgiMode: () => void;
  toggleDebugProfiler: () => void;
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void;
  addConfirmUpdateExtensionRequest: (request: ConfirmationRequest) => void;
  openWelcomeDialog: () => void;
  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P21
   */
  openSessionBrowserDialog: () => void;
}
