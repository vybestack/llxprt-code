/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentStreamInputs,
  StreamInteractionInputs,
} from '../../../hooks/agentStream/useAgentStream.js';
import type { SlashCommandProcessorCoreResult } from '../../../hooks/useSlashCommandProcessorCore.js';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { BrowserTargetDeleter } from '../../../hooks/browserCatalogHost.js';
import type { AppCommands } from '../../../contexts/AppCommandsContext.js';

import { useIdePromptComplete } from './useIdePromptComplete.js';
import {
  computeIsInputActive,
  computeIsAwaitingSlashCommandConfirmation,
} from './inputActivity.js';

import { isEditorAvailable } from '@vybestack/llxprt-code-core';
import { useOAuthControl } from '../../../contexts/OAuthControlContext.js';

import {
  computeInputWidth,
  computeSuggestionsWidth,
} from '../../../utils/ui-sizing.js';
import type React from 'react';
import { useStdin, useStdout } from 'ink';
import { useTodoContext } from '../../../contexts/TodoContext.js';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAgentStream } from '../../../hooks/agentStream/useAgentStream.js';
import type { OperationLifecycleRegistry } from '../../../hooks/agentStream/operationLifecycle.js';
import { useAutoAcceptIndicator } from '../../../hooks/useAutoAcceptIndicator.js';
import { useLoadingIndicator } from '../../../hooks/useLoadingIndicator.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { useVim } from '../../../hooks/vim.js';
import { useTextBuffer } from '../../../components/shared/text-buffer.js';
import { useInputHistoryStore } from '../../../hooks/useInputHistoryStore.js';
import { shouldClearTodos } from '../../../hooks/useTodoPausePreserver.js';
import { type HistoryItem } from '../../../types.js';
import { submitOAuthCode } from '../../../oauth-submission.js';
import type { PromptTextGenerator } from '../../../hooks/usePromptCompletion.js';
import type { EditorType } from '@vybestack/llxprt-code-core';
import type { AppState, AppAction } from '../../../reducers/appReducer.js';
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

import * as fs from 'fs';
import type { AppBootstrapResult } from './useAppBootstrap.js';
import { useMemoryRefreshAction } from './useMemoryRefreshAction.js';
import { useLogger } from '../../../hooks/useLogger.js';
import { useInputHistoryBootstrap } from './useInputHistoryBootstrap.js';
import { useInitialPromptSubmit } from './useInitialPromptSubmit.js';
import { useInputKeybindings } from './useInputKeybindings.js';
import type { UiSubagentManager } from '../../../cliUiRuntime.js';

type InputStreamOperations = Omit<
  AgentStreamInputs,
  keyof StreamInteractionInputs | 'history'
>;

export interface AppInputParams extends InputStreamOperations {
  commands: SlashCommandProcessorCoreResult;
  setQuittingMessagesRef: React.MutableRefObject<
    ((messages: HistoryItem[]) => void) | null
  >;
  disposeInput: () => Promise<void>;
  readApprovalMode: Parameters<
    typeof useAutoAcceptIndicator
  >[0]['readApprovalMode'];
  setApprovalMode: Parameters<
    typeof useAutoAcceptIndicator
  >[0]['setApprovalMode'];
  generatePromptContent: PromptTextGenerator;
  resumeBrowserTarget: AppCommands['resumeBrowserTarget'];
  readBrowserCatalog: AppCommands['readBrowserCatalog'];
  deleteBrowserTarget: BrowserTargetDeleter;
  refreshMemory: Parameters<typeof useMemoryRefreshAction>[0]['refreshMemory'];
  readDebugMode: () => boolean;
  projectTempDir: string;
  readInitialPrompt: () => string | undefined;
  isAgentClientPresent: () => boolean;
  injectInputSteer: (text: string) => void;
  endInputHookSession: Parameters<typeof useExitHandling>[0]['endHookSession'];
  readIdeMode: Parameters<typeof useInputKeybindings>[0]['readIdeMode'];
  readInteractiveShellEnabled: Parameters<
    typeof useInputKeybindings
  >[0]['readInteractiveShellEnabled'];
  readMcpServers: Parameters<typeof useInputKeybindings>[0]['readMcpServers'];
  settings: LoadedSettings;
  subagentManager?: UiSubagentManager;
  /**
   * Turn store; owns the committed history and the addItem/removeItems/
   * clearItems/loadHistory commands. History is read through a narrow
   * selector where the stream needs it; commands are stable references.
   */
  turnStore: TurnStore;
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
  const inputWidth = computeInputWidth(terminalWidth);
  const suggestionsWidth = computeSuggestionsWidth(terminalWidth);
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

function noop(): void {}

function useInputCoreProcessors(p: AppInputParams) {
  const exitResult = useExitHandling({
    handleSlashCommand: p.commands.handleSlashCommand,
    endHookSession: p.endInputHookSession,
    onBeforeExit: p.disposeInput,
  });
  p.setQuittingMessagesRef.current = exitResult.setQuittingMessages;
  return {
    ...p.commands,
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
  const oauthControl = useOAuthControl();
  const { stdin, setRawMode } = useStdin();
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
  const logger = useLogger(p.projectTempDir);
  useInputHistoryBootstrap({ inputHistoryStore, logger });
  const lastSubmittedPromptRef = useRef<string | null>('');
  const handleOAuthCodeDialogClose = useCallback(() => {
    p.dialogs.oauthCode.close();
  }, [p.dialogs]);
  const handleOAuthCodeSubmit = useCallback(
    async (code: string) => {
      submitOAuthCode(
        {
          submitCode: oauthControl.submitCode,
          getActiveProvider: () => oauthControl.getCodeRequest().provider,
        },
        code,
      );
    },
    [oauthControl],
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

function useStreamInteraction(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
) {
  const { settings } = p;
  const { stdout } = useStdout();
  const { setEmbeddedShellFocused } = p.terminalStore.commands;
  const { refreshStatic } = p.turnStore.commands;
  // The stream reads the committed transcript (checkpoint context) through a
  // narrow selector; commands come straight from the store.
  const history = useStoreSelector(p.turnStore.store, (s) => s.history);
  const { addItem, removeItems } = p.turnStore.commands;
  const handleSlashCommand = core.handleSlashCommand;
  const setDebugMessage = p.settingsStore.commands.setDebugMessage;
  const performMemoryRefresh = useMemoryRefreshAction({
    refreshMemory: p.refreshMemory,
    readDebugMode: p.readDebugMode,
    settings,
    addItem,
    setLlxprtMdFileCount: p.setLlxprtMdFileCount,
  });
  const shellModeActive = useStoreSelector(
    p.terminalStore.store,
    (s) => s.shellModeActive,
  );
  const bufferSetup = useInputBuffer(p, core);
  const { handleUserCancel } = bufferSetup;
  return {
    bufferSetup,
    input: {
      history,
      addItem,
      settings,
      onDebugMessage: setDebugMessage,
      handleSlashCommand,
      shellModeActive,
      getPreferredEditor: core.getPreferredEditor,
      onAuthError: core.onAuthError,
      performMemoryRefresh,
      onEditorClose: refreshStatic,
      onCancelSubmit: handleUserCancel,
      setShellInputFocused: setEmbeddedShellFocused,
      terminalWidth: stdout.columns,
      terminalHeight: stdout.rows,
      onEditorOpen: noop,
      removeItems,
      operationLifecycle: p.operationLifecycle,
      cancelActiveSlashCommand: core.cancelActiveSlashCommand,
    },
  };
}

function useInputStreamSetup(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
) {
  const { bufferSetup, input } = useStreamInteraction(p, core);
  const agentStreamResult = useAgentStream({
    ...input,
    readHistory: p.readHistory,
    isCheckpointingEnabled: p.isCheckpointingEnabled,
    projectCheckpointsDir: p.projectCheckpointsDir,
    stream: p.stream,
    setDisplayCallbacks: p.setDisplayCallbacks,
    setEditorCallbacks: p.setEditorCallbacks,
    openClientChannel: p.openClientChannel,
    subscribeChildTools: p.subscribeChildTools,
    appendShellHistory: p.appendShellHistory,
    injectSteer: p.injectSteer,
    cancelRunningAsyncTasks: p.cancelRunningAsyncTasks,
    getProviderContextLimit: p.getProviderContextLimit,
    getContentPrefixIdentity: p.getContentPrefixIdentity,
    getToolHandle: p.getToolHandle,
    findResource: p.findResource,
    readResource: p.readResource,
    setLastPromptTokenCount: p.setLastPromptTokenCount,
    subscribeTaskNotifications: p.subscribeTaskNotifications,
    flushRecording: p.flushRecording,
    readSessionId: p.readSessionId,
    subscribeMcpUpdates: p.subscribeMcpUpdates,
    resetBuckets: p.resetBuckets,
    resetBucketSession: p.resetBucketSession,
    ensureBucketsAuthenticated: p.ensureBucketsAuthenticated,
    atCommandConfig: p.atCommandConfig,
    logUserPrompt: p.logUserPrompt,
    getModel: p.getModel,
    getProvider: p.getProvider,
    readSelectedProvider: p.readSelectedProvider,
    readCitations: p.readCitations,
    readProfileName: p.readProfileName,
    readContextLimit: p.readContextLimit,
    getMaxSessionTurns: p.getMaxSessionTurns,
    readEmojiFilterMode: p.readEmojiFilterMode,
    projectTempDir: p.projectTempDir,
    checkpointOperations: p.checkpointOperations,
    readTargetDir: p.readTargetDir,
    readUsePty: p.readUsePty,
    readShellExecutionConfig: p.readShellExecutionConfig,
    readPtyWidth: p.readPtyWidth,
    readPtyHeight: p.readPtyHeight,
    subagentManager: p.subagentManager,
  });
  return { ...bufferSetup, agentStreamResult };
}

function useInputStreamWiring(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
  setup: ReturnType<typeof useInputStreamSetup>,
) {
  const { todos, updateTodos } = useTodoContext();
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
    p.injectInputSteer,
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
  const { handleSlashCommand } = core;
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
    readApprovalMode: p.readApprovalMode,
    setApprovalMode: p.setApprovalMode,
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
    handleSettingsRestart,
  };
}

function useInputStartup(
  p: AppInputParams,
  core: ReturnType<typeof useInputCore>,
  stream: ReturnType<typeof useInputStream>,
): void {
  useInputKeybindings({
    readIdeMode: p.readIdeMode,
    readInteractiveShellEnabled: p.readInteractiveShellEnabled,
    readMcpServers: p.readMcpServers,
    terminalStore: p.terminalStore,
    settingsStore: p.settingsStore,
    turnStore: p.turnStore,
    buffer: stream.buffer,
    cancelOngoingRequest: stream.cancelOngoingRequest,
    requestCtrlCExit: core.requestCtrlCExit,
    requestCtrlDExit: core.requestCtrlDExit,
    handleSlashCommand: core.handleSlashCommand,
  });
  const startupGuardsInitialized = useStoreSelector(
    p.settingsStore.store,
    (s) => s.startupGuardsInitialized,
  );
  const { readInitialPrompt } = p;
  const initialPrompt = useMemo(() => readInitialPrompt(), [readInitialPrompt]);
  useInitialPromptSubmit({
    initialPrompt,
    commandsReady: core.slashCommands !== undefined,
    submitPrompt: stream.handleUserInputSubmit,
    agentClientPresent: p.isAgentClientPresent(),
    interactiveRuntimeReady: stream.interactiveRuntimeReady,
    store: p.store,
    startupGuardsInitialized,
  });
}

export function useAppInput(params: AppInputParams) {
  const core = useInputCore(params);
  const stream = useInputStream(params, core);
  const finish = useInputFinish(params, core, stream);
  useInputStartup(params, core, stream);
  return {
    buffer: stream.buffer,
    commandContext: core.commandContext,
    generatePromptContent: params.generatePromptContent,
    resumeBrowserTarget: params.resumeBrowserTarget,
    readBrowserCatalog: params.readBrowserCatalog,
    deleteBrowserTarget: params.deleteBrowserTarget,
    inputHistoryStore: stream.inputHistoryStore,
    handleUserInputSubmit: stream.handleUserInputSubmit,
    handleSteer: stream.handleSteer,
    vimHandleInput: finish.vimHandleInput,
    sendAllQueuedSubmissions: stream.sendAllQueuedSubmissions,
    steerAllQueuedSubmissions: stream.steerAllQueuedSubmissions,
    clearQueuedSubmissions: stream.clearQueuedSubmissions,
    handleIdePromptComplete: finish.handleIdePromptComplete,
    handleOAuthCodeDialogClose: stream.handleOAuthCodeDialogClose,
    handleOAuthCodeSubmit: stream.handleOAuthCodeSubmit,
    handleSettingsRestart: finish.handleSettingsRestart,
  };
}

export type AppInputResult = ReturnType<typeof useAppInput>;
