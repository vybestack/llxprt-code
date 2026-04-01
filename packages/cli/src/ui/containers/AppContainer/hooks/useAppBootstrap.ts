/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useStdin, useStdout } from 'ink';
import { useResponsive } from '../../../hooks/useResponsive.js';
import { useBracketedPaste } from '../../../hooks/useBracketedPaste.js';
import { useConsoleMessages } from '../../../hooks/useConsoleMessages.js';
import { useExtensionAutoUpdate } from '../../../hooks/useExtensionAutoUpdate.js';
import { useCoreEventHandlers } from '../../../hooks/useCoreEventHandlers.js';
import {
  DEFAULT_HISTORY_MAX_BYTES,
  DEFAULT_HISTORY_MAX_ITEMS,
} from '../../../../constants/historyLimits.js';
import { useHistory } from '../../../hooks/useHistoryManager.js';
import { useMemoryMonitor } from '../../../hooks/useMemoryMonitor.js';
import { TodoPausePreserver } from '../../../hooks/useTodoPausePreserver.js';
import type {
  Config,
  IContent,
  IdeInfo,
  MessageBus,
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
} from '@vybestack/llxprt-code-core';
import { useSessionStats } from '../../../contexts/SessionContext.js';
import { useFocus } from '../../../hooks/useFocus.js';
import type { AppState, AppAction } from '../../../reducers/appReducer.js';
import type { UpdateObject } from '../../../utils/updateCheck.js';
import { useRuntimeApi } from '../../../contexts/RuntimeContext.js';
import { useTodoContext } from '../../../contexts/TodoContext.js';
import { useRecordingInfrastructure } from './useRecordingInfrastructure.js';
import { useUpdateAndOAuthBridges } from './useUpdateAndOAuthBridges.js';
import { useSessionInitialization } from './useSessionInitialization.js';
import { useTokenMetricsTracking } from './useTokenMetricsTracking.js';
import { registerCleanup } from '../../../../utils/cleanup.js';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { HistoryItem } from '../../../types.js';
import type { TodoContinuationHook } from './useTodoContinuationFlow.js';

export interface AppBootstrapProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings?: string[];
  resumedHistory?: IContent[];
  version: string;
  runtimeMessageBus?: MessageBus;
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
  recordingIntegration?: RecordingIntegration;
  initialRecordingService?: SessionRecordingService;
  initialLockHandle?: LockHandle | null;
}

export interface AppBootstrapResult {
  config: Config;
  settings: LoadedSettings;
  runtime: ReturnType<typeof useRuntimeApi>;
  isFocused: boolean;
  isNarrow: boolean;
  history: HistoryItem[];
  addItem: (
    item: Omit<HistoryItem, 'id'>,
    baseTimestamp?: number,
    isResuming?: boolean,
  ) => number;
  clearItems: () => void;
  loadHistory: (newHistory: HistoryItem[]) => void;
  llxprtMdFileCount: number;
  setLlxprtMdFileCount: (count: number) => void;
  coreMemoryFileCount: number;
  consoleMessages: ReturnType<typeof useConsoleMessages>['consoleMessages'];
  handleNewMessage: ReturnType<typeof useConsoleMessages>['handleNewMessage'];
  clearConsoleMessagesState: ReturnType<
    typeof useConsoleMessages
  >['clearConsoleMessages'];
  sessionStats: ReturnType<typeof useSessionStats>['stats'];
  updateHistoryTokenCount: ReturnType<
    typeof useSessionStats
  >['updateHistoryTokenCount'];
  tokenMetrics: ReturnType<typeof useTokenMetricsTracking>['tokenMetrics'];
  todos: ReturnType<typeof useTodoContext>['todos'];
  updateTodos: ReturnType<typeof useTodoContext>['updateTodos'];
  todoPauseController: TodoPausePreserver;
  todoContinuationRef: React.MutableRefObject<Pick<
    TodoContinuationHook,
    'handleTodoPause' | 'clearPause'
  > | null>;
  hadToolCallsRef: React.MutableRefObject<boolean>;
  registerTodoPause: () => void;
  recordingIntegrationRef: React.MutableRefObject<RecordingIntegration | null>;
  recordingSwapCallbacks: ReturnType<
    typeof useRecordingInfrastructure
  >['recordingSwapCallbacks'];
  idePromptAnswered: boolean;
  setIdePromptAnswered: React.Dispatch<React.SetStateAction<boolean>>;
  currentIDE: IdeInfo | undefined;
  shouldShowIdePrompt: boolean | null | undefined;
  updateInfo: UpdateObject | null;
  setUpdateInfo: React.Dispatch<React.SetStateAction<UpdateObject | null>>;
  stdin: ReturnType<typeof useStdin>['stdin'];
  setRawMode: ReturnType<typeof useStdin>['setRawMode'];
  stdout: ReturnType<typeof useStdout>['stdout'];
  nightly: boolean;
  runtimeMessageBus?: MessageBus;
  startupWarnings: string[];
  resumedHistory?: IContent[];
  recordingIntegration?: RecordingIntegration;
}

/** Initializes history, session, and IO primitives */
function useBootstrapHistory(props: AppBootstrapProps) {
  const { config, settings, resumedHistory } = props;
  const runtime = useRuntimeApi();
  const isFocused = useFocus();
  const { isNarrow } = useResponsive();
  useBracketedPaste();
  const [updateInfo, setUpdateInfo] = useState<UpdateObject | null>(null);
  const { stdout } = useStdout();
  const { stdin, setRawMode } = useStdin();
  const nightly = props.version.includes('nightly');
  const historyLimits = useMemo(
    () => ({
      maxItems:
        typeof settings.merged.ui.historyMaxItems === 'number'
          ? settings.merged.ui.historyMaxItems
          : DEFAULT_HISTORY_MAX_ITEMS,
      maxBytes:
        typeof settings.merged.ui.historyMaxBytes === 'number'
          ? settings.merged.ui.historyMaxBytes
          : DEFAULT_HISTORY_MAX_BYTES,
    }),
    [settings.merged.ui.historyMaxItems, settings.merged.ui.historyMaxBytes],
  );
  const { history, addItem, clearItems, loadHistory } =
    useHistory(historyLimits);
  const {
    llxprtMdFileCount,
    setLlxprtMdFileCount,
    coreMemoryFileCount,
    setCoreMemoryFileCount: _setCoreMemoryFileCount,
  } = useSessionInitialization({
    config,
    addItem,
    loadHistory,
    resumedHistory,
  });
  useMemoryMonitor({ addItem });
  return {
    runtime,
    isFocused,
    isNarrow,
    updateInfo,
    setUpdateInfo,
    stdout,
    stdin,
    setRawMode,
    nightly,
    history,
    addItem,
    clearItems,
    loadHistory,
    llxprtMdFileCount,
    setLlxprtMdFileCount,
    coreMemoryFileCount,
  };
}

/** Initializes todo state and pause controller */
function useBootstrapTodo() {
  const { todos, updateTodos } = useTodoContext();
  const todoPauseController = useMemo(() => new TodoPausePreserver(), []);
  const todoContinuationRef = useRef<Pick<
    TodoContinuationHook,
    'handleTodoPause' | 'clearPause'
  > | null>(null);
  const hadToolCallsRef = useRef<boolean>(false);
  const registerTodoPause = useCallback(() => {
    todoPauseController.registerTodoPause();
    todoContinuationRef.current?.handleTodoPause('paused by model');
  }, [todoPauseController]);
  return {
    todos,
    updateTodos,
    todoPauseController,
    todoContinuationRef,
    hadToolCallsRef,
    registerTodoPause,
  };
}

/** Initializes recording, IDE prompt, messages, and token metrics */
function useBootstrapEvents(
  props: AppBootstrapProps,
  addItem: AppBootstrapResult['addItem'],
  setUpdateInfo: React.Dispatch<React.SetStateAction<UpdateObject | null>>,
  runtime: ReturnType<typeof useRuntimeApi>,
) {
  const {
    config,
    settings,
    recordingIntegration,
    initialRecordingService,
    initialLockHandle,
  } = props;
  const { recordingIntegrationRef, recordingSwapCallbacks } =
    useRecordingInfrastructure(
      initialRecordingService,
      recordingIntegration,
      initialLockHandle,
    );
  const [idePromptAnswered, setIdePromptAnswered] = useState(false);
  const currentIDE = config.getIdeClient()?.getCurrentIde();
  useEffect(() => {
    const ideClient = config.getIdeClient();
    if (ideClient != null) {
      registerCleanup(() => ideClient.disconnect());
    }
  }, [config]);
  const shouldShowIdePrompt =
    currentIDE &&
    !config.getIdeMode() &&
    !settings.merged.hasSeenIdeIntegrationNudge &&
    !idePromptAnswered;
  useUpdateAndOAuthBridges({
    addItem,
    setUpdateInfo,
    getCliOAuthManager: runtime.getCliOAuthManager,
  });
  const {
    consoleMessages,
    handleNewMessage,
    clearConsoleMessages: clearConsoleMessagesState,
  } = useConsoleMessages();
  useExtensionAutoUpdate({ settings, onConsoleMessage: handleNewMessage });
  useCoreEventHandlers({ handleNewMessage, config, recordingIntegrationRef });
  const { stats: sessionStats, updateHistoryTokenCount } = useSessionStats();
  const { tokenMetrics } = useTokenMetricsTracking({
    config,
    updateHistoryTokenCount,
    recordingIntegrationRef,
  });
  return {
    recordingIntegrationRef,
    recordingSwapCallbacks,
    idePromptAnswered,
    setIdePromptAnswered,
    currentIDE,
    shouldShowIdePrompt,
    consoleMessages,
    handleNewMessage,
    clearConsoleMessagesState,
    sessionStats,
    updateHistoryTokenCount,
    tokenMetrics,
  };
}

export function useAppBootstrap(props: AppBootstrapProps): AppBootstrapResult {
  const h = useBootstrapHistory(props);
  const t = useBootstrapTodo();
  const e = useBootstrapEvents(props, h.addItem, h.setUpdateInfo, h.runtime);
  return {
    config: props.config,
    settings: props.settings,
    runtimeMessageBus: props.runtimeMessageBus,
    startupWarnings: props.startupWarnings ?? [],
    resumedHistory: props.resumedHistory,
    recordingIntegration: props.recordingIntegration,
    nightly: h.nightly,
    runtime: h.runtime,
    isFocused: h.isFocused,
    isNarrow: h.isNarrow,
    history: h.history,
    addItem: h.addItem,
    clearItems: h.clearItems,
    loadHistory: h.loadHistory,
    llxprtMdFileCount: h.llxprtMdFileCount,
    setLlxprtMdFileCount: h.setLlxprtMdFileCount,
    coreMemoryFileCount: h.coreMemoryFileCount,
    updateInfo: h.updateInfo,
    setUpdateInfo: h.setUpdateInfo,
    stdin: h.stdin,
    setRawMode: h.setRawMode,
    stdout: h.stdout,
    todos: t.todos,
    updateTodos: t.updateTodos,
    todoPauseController: t.todoPauseController,
    todoContinuationRef: t.todoContinuationRef,
    hadToolCallsRef: t.hadToolCallsRef,
    registerTodoPause: t.registerTodoPause,
    recordingIntegrationRef: e.recordingIntegrationRef,
    recordingSwapCallbacks: e.recordingSwapCallbacks,
    idePromptAnswered: e.idePromptAnswered,
    setIdePromptAnswered: e.setIdePromptAnswered,
    currentIDE: e.currentIDE,
    shouldShowIdePrompt: e.shouldShowIdePrompt,
    consoleMessages: e.consoleMessages,
    handleNewMessage: e.handleNewMessage,
    clearConsoleMessagesState: e.clearConsoleMessagesState,
    sessionStats: e.sessionStats,
    updateHistoryTokenCount: e.updateHistoryTokenCount,
    tokenMetrics: e.tokenMetrics,
  };
}
