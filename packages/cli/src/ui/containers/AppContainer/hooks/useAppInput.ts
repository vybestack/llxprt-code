/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAgentStream } from '../../../hooks/agentStream/index.js';
import type { OperationLifecycleRegistry } from '../../../hooks/agentStream/operationLifecycle.js';
import { useAutoAcceptIndicator } from '../../../hooks/useAutoAcceptIndicator.js';
import { useLoadingIndicator } from '../../../hooks/useLoadingIndicator.js';
import { useSlashCommandProcessor } from '../../../hooks/slashCommandProcessor.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { useVimMode } from '../../../contexts/VimModeContext.js';
import { useVim } from '../../../hooks/vim.js';
import { useTextBuffer } from '../../../components/shared/text-buffer.js';
import { useInputHistoryStore } from '../../../hooks/useInputHistoryStore.js';
import { shouldClearTodos } from '../../../hooks/useTodoPausePreserver.js';
import {
  StreamingState,
  ToolCallStatus,
  type HistoryItem,
  type HistoryItemWithoutId,
} from '../../../types.js';
import { submitOAuthCode } from '../../../oauth-submission.js';
import { getPendingOAuthProvider } from '../../../oauthGlobalState.js';
import type { EditorType } from '@vybestack/llxprt-code-core';
import { isEditorAvailable } from '@vybestack/llxprt-code-core';
import { SettingScope } from '../../../../config/settings.js';
import type { AppState, AppAction } from '../../../reducers/appReducer.js';
import type { IdeIntegrationNudgeResult } from '../../../IdeIntegrationNudge.js';
import { useSlashCommandActions } from './useSlashCommandActions.js';
import { useExitHandling } from './useExitHandling.js';
import { useInputHandling } from './useInputHandling.js';
import { useShellFocusAutoReset } from './useShellFocusAutoReset.js';
import { useSteer } from './useSteer.js';
import type { DialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import type { DialogStore } from '../../../stores/dialog/dialogStore.js';
import type {
  TerminalDimensions,
  TerminalStore,
} from '../../../stores/terminal/terminalStore.js';
import type { SettingsProfileStore } from '../../../stores/settings/settingsStore.js';
import type { TurnStore } from '../../../stores/turn/turnStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';
import type { SlashCommandProcessorActions } from '../../../hooks/slashCommandProcessor.js';

import * as fs from 'fs';
import type { AppBootstrapResult } from './useAppBootstrap.js';
import type { AppDialogsResult } from './useAppDialogs.js';
import type {
  SlashCommandRuntime,
  UiSubagentManager,
} from '../../../cliUiRuntime.js';

export interface AppInputParams {
  // From bootstrap
  streamRuntime: AppBootstrapResult['streamRuntime'];
  slashCommandRuntime: SlashCommandRuntime;
  agent: AppBootstrapResult['agent'];
  settings: AppBootstrapResult['settings'];
  runtime: AppBootstrapResult['runtime'];
  subagentManager?: UiSubagentManager;
  /**
   * Turn store; owns the committed history and the addItem/removeItems/
   * clearItems/loadHistory commands. History is read through a narrow
   * selector where the stream needs it; commands are stable references.
   */
  turnStore: TurnStore;
  todos: AppBootstrapResult['todos'];
  updateTodos: AppBootstrapResult['updateTodos'];
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
  /** Dialog openers backed by the typed DialogStore. */
  dialogs: DialogOpeners;
  /** Typed DialogStore; hosts the slash-command confirmation slot. */
  store: DialogStore;
  /** Terminal store; input owns the dimension writer effect. */
  terminalStore: TerminalStore;
  /** Settings/profile store; input mirrors stream/command projections into it. */
  settingsStore: SettingsProfileStore;
  /** Domain openers that load data before showing their dialog. */
  openProviderDialog: AppDialogsResult['openProviderDialog'];
  openLoadProfileDialog: AppDialogsResult['openLoadProfileDialog'];
  openCreateProfileDialog: AppDialogsResult['openCreateProfileDialog'];
  openProfileListDialog: AppDialogsResult['openProfileListDialog'];
  viewProfileDetail: AppDialogsResult['viewProfileDetail'];
  openProfileEditor: AppDialogsResult['openProfileEditor'];
  setDebugMessage: AppDialogsResult['setDebugMessage'];
  toggleCorgiMode: AppDialogsResult['toggleCorgiMode'];
  dispatchExtensionStateUpdate: AppDialogsResult['dispatchExtensionStateUpdate'];
  addConfirmUpdateExtensionRequest: AppDialogsResult['addConfirmUpdateExtensionRequest'];
  welcomeActions: AppDialogsResult['welcomeActions'];
  extensionsUpdateState: AppDialogsResult['extensionsUpdateState'];
  performMemoryRefresh: AppDialogsResult['performMemoryRefresh'];
  handleExternalEditorOpen: AppDialogsResult['handleExternalEditorOpen'];

  // Direct
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
  /** P12: optional perf operation lifecycle registry (perf enabled only). */
  operationLifecycle?: OperationLifecycleRegistry;
}

/**
 * Measures the terminal and derives the input/suggestion widths. The values
 * are written to the TerminalStore (dispatch -> effect ordering); the return
 * feeds the buffer viewport, which needs the width synchronously.
 */
function useTerminalDimensions(
  terminalStore: TerminalStore,
): TerminalDimensions {
  const { rows: terminalHeight, columns: terminalWidth } = useTerminalSize();
  const inputWidth = Math.max(20, Math.floor(terminalWidth * 0.9) - 6);
  const suggestionsWidth = Math.max(60, Math.floor(terminalWidth * 0.8));
  useEffect(() => {
    terminalStore.commands.setDimensions({
      terminalWidth,
      terminalHeight,
      inputWidth,
      suggestionsWidth,
    });
  }, [
    terminalStore,
    terminalWidth,
    terminalHeight,
    inputWidth,
    suggestionsWidth,
  ]);
  return { terminalWidth, terminalHeight, inputWidth, suggestionsWidth };
}

function useInputCoreCallbacks(p: AppInputParams) {
  const { settings, appDispatch, dialogs, settingsStore } = p;
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
      dialogs.editor.open({});
      return undefined;
    }
    return editorType as EditorType;
  }, [settings, dialogs]);
  const onAuthError = useCallback(() => {
    settingsStore.commands.setAuthError('reauth required');
    appDispatch({ type: 'SET_NEEDS_RELOGIN', payload: true });
  }, [settingsStore, appDispatch]);
  const handleAuthTimeout = useCallback(() => {
    settingsStore.commands.setAuthError(
      'Authentication timed out. Please try again.',
    );
  }, [settingsStore]);
  return {
    isValidPath,
    getPreferredEditor,
    onAuthError,
    handleAuthTimeout,
  };
}

function useSlashActions(
  p: AppInputParams,
  quitHandler: (messages: HistoryItem[]) => void,
): SlashCommandProcessorActions {
  return useSlashCommandActions({
    dialogs: p.dialogs,
    openProviderDialog: p.openProviderDialog,
    openLoadProfileDialog: p.openLoadProfileDialog,
    openCreateProfileDialog: p.openCreateProfileDialog,
    openProfileListDialog: p.openProfileListDialog,
    viewProfileDetail: p.viewProfileDetail,
    openProfileEditor: p.openProfileEditor,
    quitHandler,
    setDebugMessage: p.setDebugMessage,
    toggleCorgiMode: p.toggleCorgiMode,
    toggleDebugProfiler: p.terminalStore.commands.toggleDebugProfiler,
    dispatchExtensionStateUpdate: p.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest: p.addConfirmUpdateExtensionRequest,
    welcomeActions: p.welcomeActions,
  }) as SlashCommandProcessorActions;
}

function useSlashCommandSetup(
  p: AppInputParams,
  quitHandler: (messages: HistoryItem[]) => void,
  toggleVimEnabled: () => Promise<boolean>,
) {
  const {
    agent,
    settings,
    todos,
    updateTodos,
    recordingIntegrationRef,
    recordingSwapCallbacks,
    extensionsUpdateState,
    setLlxprtMdFileCount,
  } = p;
  const { addItem, clearItems, loadHistory, refreshStatic, setIsProcessing } =
    p.turnStore.commands;
  const slashCommandProcessorActions = useSlashActions(p, quitHandler);
  const todoContextForCommands = useMemo(
    () => ({ todos, updateTodos, refreshTodos: () => {} }),
    [todos, updateTodos],
  );
  return useSlashCommandProcessor(
    p.slashCommandRuntime,
    agent,
    settings,
    addItem,
    clearItems,
    loadHistory,
    refreshStatic,
    toggleVimEnabled,
    setIsProcessing,
    setLlxprtMdFileCount,
    slashCommandProcessorActions,
    p.store,
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
    config: p.streamRuntime.hooks,
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
  const dims = useTerminalDimensions(p.terminalStore);
  const cb = useInputCoreCallbacks(p);
  const proc = useInputCoreProcessors(p);
  return { dims, ...cb, ...proc };
}

function useInputBuffer(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
) {
  const { stdin, setRawMode, runtime } = p;
  const shellModeActive = useStoreSelector(
    p.terminalStore.store,
    (s) => s.shellModeActive,
  );
  const viewport = useMemo(
    () => ({ height: 10, width: core.dims.inputWidth }),
    [core.dims.inputWidth],
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
    p.dialogs.oauthCode.close();
  }, [p.dialogs]);
  const handleOAuthCodeSubmit = useCallback(
    async (code: string) => {
      submitOAuthCode(
        {
          getOAuthManager: () => runtime.getCliOAuthManager(),
          getActiveProvider: getPendingOAuthProvider,
        },
        code,
      );
    },
    [runtime],
  );
  const handleUserCancel = useCallback(
    (shouldRestorePrompt?: boolean) => {
      if (shouldRestorePrompt === true) {
        const last = lastSubmittedPromptRef.current;
        if (last != null) buffer.setText(last);
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
    streamRuntime,
    settings,
    recordingIntegration,
    runtimeMessageBus,
    stdout,
    performMemoryRefresh,
    handleExternalEditorOpen,
  } = p;
  const { setEmbeddedShellFocused } = p.terminalStore.commands;
  const { refreshStatic } = p.turnStore.commands;
  // The stream reads the committed transcript (checkpoint context) through a
  // narrow selector; commands come straight from the store.
  const history = useStoreSelector(p.turnStore.store, (s) => s.history);
  const { addItem, removeItems } = p.turnStore.commands;
  const handleSlashCommand = core.handleSlashCommand;
  const setDebugMessage = p.setDebugMessage;
  const shellModeActive = useStoreSelector(
    p.terminalStore.store,
    (s) => s.shellModeActive,
  );
  const bufferSetup = useInputBuffer(p, core);
  const { handleUserCancel } = bufferSetup;
  const agentStreamResult = useAgentStream(
    p.agent,
    history,
    addItem,
    streamRuntime,
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
    handleExternalEditorOpen,
    recordingIntegration,
    runtimeMessageBus,
    p.subagentManager,
    removeItems,
    p.operationLifecycle,
    core.cancelActiveSlashCommand,
  );
  return { ...bufferSetup, agentStreamResult };
}

function useInputStreamWiring(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
  setup: ReturnType<typeof useInputStreamSetup>,
) {
  const { todos, updateTodos } = p;
  const { setEmbeddedShellFocused } = p.terminalStore.commands;
  const embeddedShellFocused = useStoreSelector(
    p.terminalStore.store,
    (s) => s.embeddedShellFocused,
  );
  const {
    buffer,
    inputHistoryStore,
    lastSubmittedPromptRef,
    agentStreamResult,
  } = setup;
  const { submitQuery } = agentStreamResult;
  const pendingHistoryItems = useMemo(
    () => [
      ...(core.pendingHistoryItems as HistoryItem[]),
      ...agentStreamResult.pendingHistoryItems,
    ],
    [core.pendingHistoryItems, agentStreamResult.pendingHistoryItems],
  );
  const activeShellPtyId = agentStreamResult.activeShellPtyId;
  useShellFocusAutoReset({
    pendingHistoryItems,
    embeddedShellFocused,
    setEmbeddedShellFocused,
  });

  const { handleFinalSubmit } = useInputHandling({
    buffer,
    inputHistoryStore,
    submitQuery,
    pendingHistoryItems,
    lastSubmittedPromptRef,
    needsRelogin: p.appState.needsRelogin,
    openAuthDialog: () => p.dialogs.auth.open({}),
  });
  const handleUserInputSubmit = useCallback(
    (submittedValue: string) => {
      if (shouldClearTodos(todos)) {
        updateTodos([]);
      }
      handleFinalSubmit(submittedValue);
    },
    [todos, updateTodos, handleFinalSubmit],
  );
  const handleSteer = useSteer(
    p.agent,
    agentStreamResult.streamingState,
    agentStreamResult.sanitizeContent,
  );
  const {
    activeShellPtyId: _ptyIdFromStream,
    pendingHistoryItems: _pendingFromStream,
    queuedSubmissions,
    ...streamRest
  } = agentStreamResult;
  return {
    handleFinalSubmit,
    handleUserInputSubmit,
    handleSteer,
    pendingHistoryItems,
    activeShellPtyId,
    queuedSubmissions,
    ...streamRest,
  };
}

function useInputStream(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
) {
  const setup = useInputStreamSetup(p, core);
  const wiring = useInputStreamWiring(p, core, setup);
  const { agentStreamResult: _agentStreamResult, ...setupRest } = setup;
  return { ...setupRest, ...wiring };
}

export interface IsInputActiveInputs {
  streamingState: StreamingState;
  initError: string | null;
  hasSlashCommands: boolean;
  /** True while a slash command is blocked on a shell-expansion approval. */
  isAwaitingSlashCommandConfirmation: boolean;
}

/**
 * True when a slash command has put a confirmation on screen that owns the
 * keyboard. `confirm_action` renders through the dialog manager, which
 * replaces the whole inline layout; `confirm_shell_commands` instead parks a
 * Confirming tool group in the processor's pending items, which is what this
 * detects.
 */
export function computeIsAwaitingSlashCommandConfirmation(
  pendingItems: readonly HistoryItemWithoutId[],
): boolean {
  return pendingItems.some(
    (item) =>
      item.type === 'tool_group' &&
      item.tools.some((tool) => tool.status === ToolCallStatus.Confirming),
  );
}

/**
 * Decides whether the composer is rendered.
 *
 * This deliberately does NOT key off the slash-command pipeline being busy.
 * Doing so hid the prompt for the entire duration of a long command
 * (issue #2976). The composer only has to stand down when something else owns
 * the keyboard, which is what the streaming and confirmation terms cover.
 */
export function computeIsInputActive(inputs: IsInputActiveInputs): boolean {
  const isStreamingIdleOrResponding =
    inputs.streamingState === StreamingState.Idle ||
    inputs.streamingState === StreamingState.Responding;
  return (
    isStreamingIdleOrResponding &&
    !inputs.initError &&
    inputs.hasSlashCommands &&
    !inputs.isAwaitingSlashCommandConfirmation
  );
}

/**
 * IDE nudge resolution: slash-command-driven enable/install plus a persisted
 * "seen" flag so the nudge never renders twice.
 */
function useIdePromptComplete(
  settings: AppInputParams['settings'],
  handleSlashCommand: ReturnType<typeof useInputCore>['handleSlashCommand'],
  setIdePromptAnswered: AppInputParams['setIdePromptAnswered'],
) {
  return useCallback(
    (result: IdeIntegrationNudgeResult) => {
      if (result.userSelection === 'yes') {
        if (result.isExtensionPreInstalled) {
          void handleSlashCommand('/ide enable');
        } else {
          void handleSlashCommand('/ide install');
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
}

/**
 * Settings/terminal mirrors: the layout tree reads init error, slash
 * commands, auto-accept indicator and shell focus through store selectors;
 * these writer effects preserve dispatch -> effect ordering.
 */
function useSettingsStoreMirrors(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
  stream: ReturnType<typeof useInputStream>,
  showAutoAcceptIndicator: ReturnType<typeof useAutoAcceptIndicator>,
) {
  const { setInitError, setSlashCommands, setShowAutoAcceptIndicator } =
    p.settingsStore.commands;
  useEffect(() => {
    setInitError(stream.initError);
  }, [setInitError, stream.initError]);
  useEffect(() => {
    setSlashCommands(core.slashCommands);
  }, [setSlashCommands, core.slashCommands]);
  useEffect(() => {
    setShowAutoAcceptIndicator(showAutoAcceptIndicator);
  }, [setShowAutoAcceptIndicator, showAutoAcceptIndicator]);
  const { setActiveShellPtyId } = p.terminalStore.commands;
  useEffect(() => {
    setActiveShellPtyId(stream.activeShellPtyId);
  }, [setActiveShellPtyId, stream.activeShellPtyId]);
}

/**
 * Turn mirrors: the stream/exit hooks stay value-returning; these writer
 * effects project their results into the TurnStore for the layout tree.
 */
function useTurnStoreMirrors(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
  stream: ReturnType<typeof useInputStream>,
  mirrors: {
    elapsedTime: number;
    currentLoadingPhrase: string;
  },
) {
  const {
    setStreamingState,
    setThought,
    setPendingHistoryItems,
    setQuittingMessages,
    setCtrlCPressedOnce,
    setCtrlDPressedOnce,
    setQueuedSubmissions,
    setElapsedTime,
    setCurrentLoadingPhrase,
  } = p.turnStore.commands;
  useEffect(() => {
    setStreamingState(stream.streamingState);
  }, [setStreamingState, stream.streamingState]);
  useEffect(() => {
    setThought(stream.thought);
  }, [setThought, stream.thought]);
  useEffect(() => {
    setPendingHistoryItems(stream.pendingHistoryItems);
  }, [setPendingHistoryItems, stream.pendingHistoryItems]);
  useEffect(() => {
    setQuittingMessages(core.quittingMessages);
  }, [setQuittingMessages, core.quittingMessages]);
  useEffect(() => {
    setCtrlCPressedOnce(core.ctrlCPressedOnce);
  }, [setCtrlCPressedOnce, core.ctrlCPressedOnce]);
  useEffect(() => {
    setCtrlDPressedOnce(core.ctrlDPressedOnce);
  }, [setCtrlDPressedOnce, core.ctrlDPressedOnce]);
  useEffect(() => {
    setQueuedSubmissions(stream.queuedSubmissions);
  }, [setQueuedSubmissions, stream.queuedSubmissions]);
  useEffect(() => {
    setElapsedTime(mirrors.elapsedTime);
  }, [setElapsedTime, mirrors.elapsedTime]);
  useEffect(() => {
    setCurrentLoadingPhrase(mirrors.currentLoadingPhrase);
  }, [setCurrentLoadingPhrase, mirrors.currentLoadingPhrase]);
}

function useInputFinish(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
  stream: ReturnType<typeof useInputStream>,
) {
  const { settings, setIdePromptAnswered } = p;
  const { handleSlashCommand, vimModeEnabled, vimMode, toggleVimEnabled } =
    core;
  const {
    buffer,
    handleFinalSubmit,
    streamingState,
    initError,
    slashCommands,
  } = { ...core, ...stream };
  const embeddedShellFocused = useStoreSelector(
    p.terminalStore.store,
    (s) => s.embeddedShellFocused,
  );
  const handleIdePromptComplete = useIdePromptComplete(
    settings,
    handleSlashCommand,
    setIdePromptAnswered,
  );
  const { handleInput: vimHandleInput } = useVim(buffer, handleFinalSubmit);
  const { elapsedTime, currentLoadingPhrase } = useLoadingIndicator(
    streamingState,
    settings.merged.ui.wittyPhraseStyle ??
      settings.merged.wittyPhraseStyle ??
      'default',
    settings.merged.ui.customWittyPhrases ?? settings.merged.customWittyPhrases,
    stream.activeShellPtyId != null && !embeddedShellFocused,
    stream.lastOutputTime,
  );
  const showAutoAcceptIndicator = useAutoAcceptIndicator({
    agent: p.agent,
    addItem: p.turnStore.commands.addItem,
  });
  // Store mirrors: the stream/command projections the layout tree reads live
  // in the stores; these writer effects preserve dispatch -> effect ordering.
  useSettingsStoreMirrors(p, core, stream, showAutoAcceptIndicator);
  // Turn mirrors: the stream/exit hooks stay value-returning; these writer
  // effects project their results into the TurnStore for the layout tree.
  useTurnStoreMirrors(p, core, stream, { elapsedTime, currentLoadingPhrase });
  const handleSettingsRestart = useCallback(() => {
    void handleSlashCommand('/quit');
  }, [handleSlashCommand]);
  const isInputActive = computeIsInputActive({
    streamingState,
    initError,
    hasSlashCommands: !!slashCommands,
    isAwaitingSlashCommandConfirmation:
      computeIsAwaitingSlashCommandConfirmation(core.pendingHistoryItems),
  });
  // The composer-active decision lands in the TerminalStore; readers
  // subscribe instead of receiving it through the hook bag.
  useEffect(() => {
    p.terminalStore.commands.setInputActive(isInputActive);
  }, [p.terminalStore, isInputActive]);
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
  };
}

export function useAppInput(params: AppInputParams) {
  const core = useInputCore(params);
  const stream = useInputStream(params, core);
  const finish = useInputFinish(params, core, stream);
  // Terminal dims live in the TerminalStore; only the buffer viewport keeps a
  // local copy, so the public bag drops them here.
  const { dims: _dims, ...publicResult } = { ...core, ...stream, ...finish };
  return publicResult;
}

export type AppInputResult = ReturnType<typeof useAppInput>;
