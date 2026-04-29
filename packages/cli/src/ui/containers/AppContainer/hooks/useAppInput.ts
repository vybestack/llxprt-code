/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useMemo, useRef } from 'react';
import { useGeminiStream } from '../../../hooks/geminiStream/index.js';
import { useAutoAcceptIndicator } from '../../../hooks/useAutoAcceptIndicator.js';
import { useLoadingIndicator } from '../../../hooks/useLoadingIndicator.js';
import { useMcpStatus } from '../../../hooks/useMcpStatus.js';
import { useMessageQueue } from '../../../hooks/useMessageQueue.js';
import { useSlashCommandProcessor } from '../../../hooks/slashCommandProcessor.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { useVimMode } from '../../../contexts/VimModeContext.js';
import { useVim } from '../../../hooks/vim.js';
import { useTextBuffer } from '../../../components/shared/text-buffer.js';
import { useInputHistoryStore } from '../../../hooks/useInputHistoryStore.js';
import { useTodoPausePreserver } from '../../../hooks/useTodoPausePreserver.js';
import { StreamingState, type HistoryItem } from '../../../types.js';
import { submitOAuthCode } from '../../../oauth-submission.js';
import type { EditorType } from '@vybestack/llxprt-code-core';
import { isEditorAvailable } from '@vybestack/llxprt-code-core';
import { SettingScope } from '../../../../config/settings.js';
import type { AppState, AppAction } from '../../../reducers/appReducer.js';
import type { IdeIntegrationNudgeResult } from '../../../IdeIntegrationNudge.js';
import { useSlashCommandActions } from './useSlashCommandActions.js';
import { useExitHandling } from './useExitHandling.js';
import { useInputHandling } from './useInputHandling.js';
import { useShellFocusAutoReset } from './useShellFocusAutoReset.js';
import * as fs from 'fs';
import type { AppBootstrapResult } from './useAppBootstrap.js';
import type { AppDialogsResult } from './useAppDialogs.js';

export interface AppInputParams {
  // From bootstrap
  config: AppBootstrapResult['config'];
  settings: AppBootstrapResult['settings'];
  runtime: AppBootstrapResult['runtime'];
  history: AppBootstrapResult['history'];
  addItem: (item: Omit<HistoryItem, 'id'>, baseTimestamp?: number) => number;
  clearItems: AppBootstrapResult['clearItems'];
  loadHistory: AppBootstrapResult['loadHistory'];
  todos: AppBootstrapResult['todos'];
  updateTodos: AppBootstrapResult['updateTodos'];
  todoPauseController: AppBootstrapResult['todoPauseController'];
  todoContinuationRef: AppBootstrapResult['todoContinuationRef'];
  hadToolCallsRef: AppBootstrapResult['hadToolCallsRef'];
  registerTodoPause: AppBootstrapResult['registerTodoPause'];
  recordingIntegrationRef: AppBootstrapResult['recordingIntegrationRef'];
  recordingSwapCallbacks: AppBootstrapResult['recordingSwapCallbacks'];
  recordingIntegration: AppBootstrapResult['recordingIntegration'];
  runtimeMessageBus: AppBootstrapResult['runtimeMessageBus'];
  stdin: AppBootstrapResult['stdin'];
  setRawMode: AppBootstrapResult['setRawMode'];
  stdout: AppBootstrapResult['stdout'];
  setIdePromptAnswered: AppBootstrapResult['setIdePromptAnswered'];
  setLlxprtMdFileCount: AppBootstrapResult['setLlxprtMdFileCount'];

  // From dialogs
  openAuthDialog: AppDialogsResult['openAuthDialog'];
  openThemeDialog: AppDialogsResult['openThemeDialog'];
  openEditorDialog: AppDialogsResult['openEditorDialog'];
  openPrivacyNotice: AppDialogsResult['openPrivacyNotice'];
  openSettingsDialog: AppDialogsResult['openSettingsDialog'];
  openLoggingDialog: AppDialogsResult['openLoggingDialog'];
  openSubagentDialog: AppDialogsResult['openSubagentDialog'];
  openModelsDialog: AppDialogsResult['openModelsDialog'];
  openPermissionsDialog: AppDialogsResult['openPermissionsDialog'];
  openProviderDialog: AppDialogsResult['openProviderDialog'];
  openLoadProfileDialog: AppDialogsResult['openLoadProfileDialog'];
  openCreateProfileDialog: AppDialogsResult['openCreateProfileDialog'];
  openProfileListDialog: AppDialogsResult['openProfileListDialog'];
  viewProfileDetail: AppDialogsResult['viewProfileDetail'];
  openProfileEditor: AppDialogsResult['openProfileEditor'];
  openSessionBrowserDialog: AppDialogsResult['openSessionBrowserDialog'];
  setDebugMessage: AppDialogsResult['setDebugMessage'];
  toggleCorgiMode: AppDialogsResult['toggleCorgiMode'];
  toggleDebugProfiler: AppDialogsResult['toggleDebugProfiler'];
  dispatchExtensionStateUpdate: AppDialogsResult['dispatchExtensionStateUpdate'];
  addConfirmUpdateExtensionRequest: AppDialogsResult['addConfirmUpdateExtensionRequest'];
  welcomeActions: AppDialogsResult['welcomeActions'];
  extensionsUpdateState: AppDialogsResult['extensionsUpdateState'];
  setIsProcessing: AppDialogsResult['setIsProcessing'];
  setEmbeddedShellFocused: AppDialogsResult['setEmbeddedShellFocused'];
  embeddedShellFocused: AppDialogsResult['embeddedShellFocused'];
  setAuthError: AppDialogsResult['setAuthError'];
  shellModeActive: AppDialogsResult['shellModeActive'];
  isProcessing: AppDialogsResult['isProcessing'];
  performMemoryRefresh: AppDialogsResult['performMemoryRefresh'];
  handleExternalEditorOpen: AppDialogsResult['handleExternalEditorOpen'];
  refreshStatic: AppDialogsResult['refreshStatic'];

  // Direct
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
}

function useInputCoreCallbacks(p: AppInputParams) {
  const { settings, openEditorDialog, setAuthError, appDispatch } = p;
  const { rows: terminalHeight, columns: terminalWidth } = useTerminalSize();
  const inputWidth = Math.max(20, Math.floor(terminalWidth * 0.9) - 6);
  const suggestionsWidth = Math.max(60, Math.floor(terminalWidth * 0.8));
  const isValidPath = useCallback((filePath: string): boolean => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }, []);
  const getPreferredEditor = useCallback(() => {
    const editorType = settings.merged.ui.preferredEditor;
    if (!isEditorAvailable(editorType)) {
      openEditorDialog();
      return;
    }
    return editorType as EditorType;
  }, [settings, openEditorDialog]);
  const onAuthError = useCallback(() => {
    setAuthError('reauth required');
    appDispatch({ type: 'OPEN_DIALOG', payload: 'auth' });
  }, [setAuthError, appDispatch]);
  const handleAuthTimeout = useCallback(() => {
    setAuthError('Authentication timed out. Please try again.');
  }, [setAuthError]);
  return {
    terminalHeight,
    terminalWidth,
    inputWidth,
    suggestionsWidth,
    isValidPath,
    getPreferredEditor,
    onAuthError,
    handleAuthTimeout,
  };
}

function useSlashActions(
  p: AppInputParams,
  quitHandler: (messages: HistoryItem[]) => void,
) {
  return useSlashCommandActions({
    openAuthDialog: p.openAuthDialog,
    openThemeDialog: p.openThemeDialog,
    openEditorDialog: p.openEditorDialog,
    openPrivacyNotice: p.openPrivacyNotice,
    openSettingsDialog: p.openSettingsDialog,
    openLoggingDialog: p.openLoggingDialog,
    openSubagentDialog: p.openSubagentDialog,
    openModelsDialog: p.openModelsDialog,
    openPermissionsDialog: p.openPermissionsDialog,
    openProviderDialog: p.openProviderDialog,
    openLoadProfileDialog: p.openLoadProfileDialog,
    openCreateProfileDialog: p.openCreateProfileDialog,
    openProfileListDialog: p.openProfileListDialog,
    viewProfileDetail: p.viewProfileDetail,
    openProfileEditor: p.openProfileEditor,
    quitHandler,
    setDebugMessage: p.setDebugMessage,
    toggleCorgiMode: p.toggleCorgiMode,
    toggleDebugProfiler: p.toggleDebugProfiler,
    dispatchExtensionStateUpdate: p.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest: p.addConfirmUpdateExtensionRequest,
    welcomeActions: p.welcomeActions as { resetAndReopen: () => void },
    openSessionBrowserDialog: p.openSessionBrowserDialog,
  });
}

function useSlashCommandSetup(
  p: AppInputParams,
  quitHandler: (messages: HistoryItem[]) => void,
  toggleVimEnabled: () => Promise<boolean>,
) {
  const {
    config,
    settings,
    addItem,
    clearItems,
    loadHistory,
    todos,
    updateTodos,
    recordingIntegrationRef,
    recordingSwapCallbacks,
    extensionsUpdateState,
    setIsProcessing,
    setLlxprtMdFileCount,
    refreshStatic,
  } = p;
  const slashCommandProcessorActions = useSlashActions(p, quitHandler);
  const todoContextForCommands = useMemo(
    () => ({ todos, updateTodos, refreshTodos: () => {} }),
    [todos, updateTodos],
  );
  return useSlashCommandProcessor(
    config,
    settings,
    addItem,
    clearItems,
    loadHistory,
    refreshStatic,
    toggleVimEnabled,
    setIsProcessing,
    setLlxprtMdFileCount,
    slashCommandProcessorActions,
    extensionsUpdateState,
    true,
    todoContextForCommands,
    recordingIntegrationRef.current ?? undefined,
    recordingSwapCallbacks,
  );
}

function useInputCoreProcessors(p: AppInputParams) {
  const {
    vimEnabled: vimModeEnabled,
    vimMode,
    toggleVimEnabled,
  } = useVimMode();
  const setQuittingMessagesRef = useRef<
    ((messages: HistoryItem[]) => void) | null
  >(null);
  const quitHandler = useCallback((messages: HistoryItem[]) => {
    if (setQuittingMessagesRef.current)
      setQuittingMessagesRef.current(messages);
  }, []);
  const slashResult = useSlashCommandSetup(p, quitHandler, toggleVimEnabled);
  const exitResult = useExitHandling({
    handleSlashCommand: slashResult.handleSlashCommand,
    config: p.config,
  });
  setQuittingMessagesRef.current = exitResult.setQuittingMessages;
  return {
    vimModeEnabled,
    vimMode,
    toggleVimEnabled,
    setQuittingMessagesRef,
    ...slashResult,
    ...exitResult,
  };
}

function useInputCore(p: AppInputParams) {
  const cb = useInputCoreCallbacks(p);
  const proc = useInputCoreProcessors(p);
  return { ...cb, ...proc };
}

function useInputBuffer(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
) {
  const { stdin, setRawMode, appDispatch, runtime } = p;
  const { shellModeActive } = p;
  const viewport = useMemo(
    () => ({ height: 10, width: core.inputWidth }),
    [core.inputWidth],
  );
  const buffer = useTextBuffer({
    initialText: '',
    viewport,
    stdin,
    setRawMode,
    isValidPath: core.isValidPath,
    shellModeActive,
  });
  const inputHistoryStore = useInputHistoryStore();
  const lastSubmittedPromptRef = useRef<string | null>('');
  const handleOAuthCodeDialogClose = useCallback(() => {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
  }, [appDispatch]);
  const handleOAuthCodeSubmit = useCallback(
    async (code: string) => {
      submitOAuthCode(
        {
          getOAuthManager: () => runtime.getCliOAuthManager(),
          getActiveProvider: () =>
            (global as unknown as { __oauth_provider?: string })
              .__oauth_provider,
        },
        code,
      );
    },
    [runtime],
  );
  const handleUserCancel = useCallback(
    (shouldRestorePrompt?: boolean) => {
      if (shouldRestorePrompt) {
        const last = lastSubmittedPromptRef.current;
        if (last) buffer.setText(last);
      } else buffer.setText('');
    },
    [buffer],
  );
  return {
    buffer,
    viewport,
    inputHistoryStore,
    lastSubmittedPromptRef,
    handleOAuthCodeDialogClose,
    handleOAuthCodeSubmit,
    handleUserCancel,
  };
}

function useInputStreamSetup(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
) {
  const {
    config,
    settings,
    history,
    addItem,
    registerTodoPause,
    recordingIntegration,
    runtimeMessageBus,
    stdout,
    setEmbeddedShellFocused,
    performMemoryRefresh,
    handleExternalEditorOpen,
    refreshStatic,
  } = p;
  const { handleSlashCommand, setDebugMessage, shellModeActive } = {
    ...core,
    ...p,
  };
  const bufferSetup = useInputBuffer(p, core);
  const { handleUserCancel } = bufferSetup;
  const geminiResult = useGeminiStream(
    config.getGeminiClient(),
    history,
    addItem,
    config,
    settings,
    setDebugMessage,
    handleSlashCommand,
    shellModeActive,
    core.getPreferredEditor,
    core.onAuthError,
    performMemoryRefresh,
    refreshStatic,
    handleUserCancel,
    setEmbeddedShellFocused,
    stdout.columns,
    stdout.rows,
    registerTodoPause,
    handleExternalEditorOpen,
    recordingIntegration,
    runtimeMessageBus,
  );
  return { ...bufferSetup, geminiResult };
}

function useInputStreamWiring(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
  setup: ReturnType<typeof useInputStreamSetup>,
) {
  const {
    todos,
    updateTodos,
    todoPauseController,
    todoContinuationRef,
    hadToolCallsRef,
    embeddedShellFocused,
    setEmbeddedShellFocused,
  } = p;
  const { buffer, inputHistoryStore, lastSubmittedPromptRef, geminiResult } =
    setup;
  const pendingHistoryItems = useMemo(
    () => [
      ...(core.pendingHistoryItems as HistoryItem[]),
      ...geminiResult.pendingHistoryItems,
    ],
    [core.pendingHistoryItems, geminiResult.pendingHistoryItems],
  );
  const activeShellPtyId = geminiResult.activeShellPtyId;
  useShellFocusAutoReset({
    pendingHistoryItems,
    embeddedShellFocused,
    setEmbeddedShellFocused,
  });

  // MCP readiness: derives isMcpReady from discovery state via coreEvents.
  const { isMcpReady } = useMcpStatus(p.config);

  // Message queue: holds prompts submitted while MCP init or streaming is in
  // progress. Auto-flushes as a combined submission when all gates open.
  const { messageQueue, addMessage } = useMessageQueue({
    isConfigInitialized: true,
    streamingState: geminiResult.streamingState,
    submitQuery: geminiResult.submitQuery,
    isMcpReady,
  });

  const { handleFinalSubmit } = useInputHandling({
    buffer,
    inputHistoryStore,
    submitQuery: geminiResult.submitQuery,
    pendingHistoryItems,
    lastSubmittedPromptRef,
    hadToolCallsRef,
    todoContinuationRef,
    isMcpReady,
    addMessage,
  });
  const { handleUserInputSubmit } = useTodoPausePreserver({
    controller: todoPauseController,
    updateTodos,
    handleFinalSubmit,
    todos,
  });
  const {
    activeShellPtyId: _ptyIdFromGemini,
    pendingHistoryItems: _pendingFromGemini,
    ...geminiRest
  } = geminiResult;
  return {
    handleFinalSubmit,
    handleUserInputSubmit,
    pendingHistoryItems,
    activeShellPtyId,
    messageQueue,
    isMcpReady,
    ...geminiRest,
  };
}

function useInputStream(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
) {
  const setup = useInputStreamSetup(p, core);
  const wiring = useInputStreamWiring(p, core, setup);
  const { geminiResult: _geminiResult, ...setupRest } = setup;
  return { ...setupRest, ...wiring };
}

function useInputFinish(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
  stream: ReturnType<typeof useInputStream>,
) {
  const { config, settings, setIdePromptAnswered, isProcessing } = p;
  const { handleSlashCommand, vimModeEnabled, vimMode, toggleVimEnabled } =
    core;
  const {
    buffer,
    handleFinalSubmit,
    streamingState,
    initError,
    slashCommands,
  } = { ...core, ...stream };
  const handleIdePromptComplete = useCallback(
    (result: IdeIntegrationNudgeResult) => {
      if (result.userSelection === 'yes') {
        if (result.isExtensionPreInstalled) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          handleSlashCommand('/ide enable');
        } else {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          handleSlashCommand('/ide install');
        }
        settings.setValue(
          SettingScope.User,
          'hasSeenIdeIntegrationNudge',
          true,
        );
      } else if (result.userSelection === 'dismiss') {
        settings.setValue(
          SettingScope.User,
          'hasSeenIdeIntegrationNudge',
          true,
        );
      }
      setIdePromptAnswered(true);
    },
    [handleSlashCommand, settings, setIdePromptAnswered],
  );
  const { handleInput: vimHandleInput } = useVim(buffer, handleFinalSubmit);
  const { elapsedTime, currentLoadingPhrase } = useLoadingIndicator(
    streamingState,
    settings.merged.ui.wittyPhraseStyle ??
      settings.merged.wittyPhraseStyle ??
      'default',
    settings.merged.ui.customWittyPhrases ?? settings.merged.customWittyPhrases,
    !!stream.activeShellPtyId && !p.embeddedShellFocused,
    stream.lastOutputTime,
  );
  const showAutoAcceptIndicator = useAutoAcceptIndicator({
    config,
    addItem: p.addItem,
  });
  const handleSettingsRestart = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    handleSlashCommand('/quit');
  }, [handleSlashCommand]);
  const isInputActive =
    (streamingState === StreamingState.Idle ||
      streamingState === StreamingState.Responding) &&
    !initError &&
    !isProcessing &&
    !!slashCommands;
  return {
    handleIdePromptComplete,
    vimHandleInput,
    vimModeEnabled,
    vimMode,
    toggleVimEnabled,
    elapsedTime,
    currentLoadingPhrase,
    showAutoAcceptIndicator,
    handleSettingsRestart,
    isInputActive,
  };
}

export function useAppInput(params: AppInputParams) {
  const core = useInputCore(params);
  const stream = useInputStream(params, core);
  const finish = useInputFinish(params, core, stream);
  return { ...core, ...stream, ...finish };
}

export type AppInputResult = ReturnType<typeof useAppInput>;
