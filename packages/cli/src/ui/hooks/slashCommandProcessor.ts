/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  RecordingIntegration,
  Todo,
} from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import type { HistoryItem, ConfirmationRequest } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { ModelsDialogData } from '../commands/types.js';
import type {
  ExtensionUpdateState,
  ExtensionUpdateAction,
} from '../state/extensions.js';
import type { SubagentView } from '../components/SubagentManagement/types.js';
import { useSlashCommandProcessorCore } from './useSlashCommandProcessorCore.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

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

interface TodoContextValue {
  todos: Todo[];
  updateTodos: (todos: Todo[]) => void;
  refreshTodos: () => void;
}

/**
 * Hook to define and process slash commands (e.g., /help, /clear).
 *
 * @plan PLAN-20260129-TODOPERSIST.P07 - Added todoContext param
 * @plan PLAN-20260214-SESSIONBROWSER.P23 - Added recordingSwapCallbacks for /continue command
 */
export const useSlashCommandProcessor = (
  config: Config | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  clearItems: UseHistoryManagerReturn['clearItems'],
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  refreshStatic: () => void,
  toggleVimEnabled: () => Promise<boolean>,
  setIsProcessing: (isProcessing: boolean) => void,
  setLlxprtMdFileCount: (count: number) => void,
  actions: SlashCommandProcessorActions,
  extensionsUpdateState: Map<string, ExtensionUpdateState>,
  isConfigInitialized: boolean,
  todoContext?: TodoContextValue,
  recordingIntegration?: RecordingIntegration,
  recordingSwapCallbacks?: RecordingSwapCallbacks,
) =>
  useSlashCommandProcessorCore({
    config,
    settings,
    addItem,
    clearItems,
    loadHistory,
    refreshStatic,
    toggleVimEnabled,
    setIsProcessing,
    setLlxprtMdFileCount,
    actions,
    extensionsUpdateState,
    isConfigInitialized,
    todoContext,
    recordingIntegration,
    recordingSwapCallbacks,
  });
