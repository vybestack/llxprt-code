/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import {
  createContext,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useReducer,
} from 'react';
import type { HistoryItem } from '../types.js';
import { MessageType } from '../types.js';
import { useHistory } from '../hooks/useHistoryManager.js';
import { useRuntimeApi, getRuntimeApi } from '../contexts/RuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  getErrorMessage,
  loadCoreMemoryContent,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import { loadHierarchicalLlxprtMemory } from '../../config/environmentLoader.js';
import { loadSettings } from '../../config/settings.js';
import {
  SessionStateProvider,
  useSessionState,
} from '../contexts/SessionStateContext.js';
import type {
  SessionState,
  SessionAction,
} from '../reducers/sessionReducer.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import type { AppAction, AppState } from '../reducers/appReducer.js';
import { appReducer, initialAppState } from '../reducers/appReducer.js';

// Context type
export interface SessionContextType {
  history: HistoryItem[];
  addItem: (
    itemData: Omit<HistoryItem, 'id'>,
    baseTimestamp?: number,
  ) => number;
  updateItem: (
    id: number,
    updates:
      | Partial<Omit<HistoryItem, 'id'>>
      | ((prevItem: HistoryItem) => Partial<Omit<HistoryItem, 'id'>>),
  ) => void;
  clearItems: () => void;
  loadHistory: (newHistory: HistoryItem[]) => void;
  sessionState: SessionState;
  dispatch: React.Dispatch<SessionAction>;
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
  checkPaymentModeChange: (forcePreviousProvider?: string) => void;
  performMemoryRefresh: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextType | undefined>(
  undefined,
);

interface SessionControllerProps {
  children: React.ReactNode;
  config: Config;
}

export const SessionController: React.FC<SessionControllerProps> = ({
  children,
  config,
}) => {
  const runtime = useRuntimeApi();
  const statusSnapshot = runtime.getActiveProviderStatus();

  const initialState: SessionState = {
    currentModel:
      statusSnapshot.providerName && statusSnapshot.modelName
        ? `${statusSnapshot.providerName}:${statusSnapshot.modelName}`
        : (statusSnapshot.modelName ?? config.getModel()),
    isPaidMode: statusSnapshot.isPaidMode,
    lastProvider: statusSnapshot.providerName ?? undefined,
    userTier: undefined,
    transientWarnings: [],
  };

  return (
    <SessionStateProvider initialState={initialState}>
      <SessionControllerInner {...{ children, config }} />
    </SessionStateProvider>
  );
};

function scheduleWarningClear(
  warningTimerRef: React.MutableRefObject<NodeJS.Timeout | null>,
  dispatch: React.Dispatch<SessionAction>,
): void {
  if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
  warningTimerRef.current = setTimeout(() => {
    dispatch({ type: 'CLEAR_TRANSIENT_WARNINGS' });
    warningTimerRef.current = null;
  }, 10000);
}

function useCheckPaymentModeChange(
  sessionState: SessionState,
  historyLength: number,
  dispatch: React.Dispatch<SessionAction>,
  warningTimerRef: React.MutableRefObject<NodeJS.Timeout | null>,
): (forcePreviousProvider?: string) => void {
  return useCallback(
    (forcePreviousProvider?: string) => {
      const runtime = getRuntimeApi();
      const status = runtime.getActiveProviderStatus();
      const newPaymentMode = status.isPaidMode;
      const currentProviderName = status.providerName ?? undefined;
      const previousProvider =
        forcePreviousProvider ?? sessionState.lastProvider;
      const providerChanged =
        currentProviderName != null && currentProviderName !== previousProvider;
      const paymentModeChanged =
        newPaymentMode !== sessionState.isPaidMode &&
        newPaymentMode !== undefined;
      if (
        (paymentModeChanged || providerChanged) &&
        (providerChanged || historyLength > 0)
      ) {
        dispatch({ type: 'SET_PAID_MODE', payload: newPaymentMode });
        dispatch({ type: 'SET_LAST_PROVIDER', payload: currentProviderName });
        if (status.providerName === 'gemini') {
          if (newPaymentMode === true) {
            dispatch({
              type: 'SET_TRANSIENT_WARNINGS',
              payload: [
                `! PAID MODE: You are now using Gemini with API credentials - usage will be charged to your account`,
              ],
            });
          } else if (newPaymentMode === false) {
            dispatch({
              type: 'SET_TRANSIENT_WARNINGS',
              payload: [
                `FREE MODE: You are now using Gemini with OAuth authentication - no charges will apply`,
              ],
            });
          }
        }
        scheduleWarningClear(warningTimerRef, dispatch);
      }
    },
    [
      sessionState.isPaidMode,
      sessionState.lastProvider,
      historyLength,
      dispatch,
      warningTimerRef,
    ],
  );
}

function usePerformMemoryRefresh(
  config: Config,
  addItem: (
    itemData: Omit<HistoryItem, 'id'>,
    baseTimestamp?: number,
  ) => number,
): () => Promise<void> {
  return useCallback(async () => {
    addItem(
      {
        type: MessageType.INFO,
        text: 'Refreshing hierarchical memory (LLXPRT.md or other context files)...',
      },
      Date.now(),
    );
    try {
      const settings = loadSettings(config.getWorkingDir());
      const { memoryContent, fileCount } = await loadHierarchicalLlxprtMemory(
        config.getWorkingDir(),
        config.shouldLoadMemoryFromIncludeDirectories()
          ? config.getWorkspaceContext().getDirectories()
          : [],
        config.getDebugMode(),
        config.getFileService(),
        settings.merged,
        config.getExtensions(),
        config.getFolderTrust(),
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for empty-string memory import format
        settings.merged.ui.memoryImportFormat || 'tree',
        config.getFileFilteringOptions(),
      );
      config.setUserMemory(memoryContent);
      config.setLlxprtMdFileCount(fileCount);
      try {
        const coreContent = await loadCoreMemoryContent(config.getWorkingDir());
        config.setCoreMemory(coreContent);
      } catch {
        // Non-fatal: keep existing core memory
      }
      const charCount = memoryContent.length;
      const refreshDetails =
        charCount > 0
          ? `Loaded ${charCount} characters from ${fileCount} file(s).`
          : 'No memory content found.';
      addItem(
        {
          type: MessageType.INFO,
          text: `Memory refreshed successfully. ${refreshDetails}`,
        },
        Date.now(),
      );
      if (config.getDebugMode()) {
        debugLogger.log(
          `Refreshed memory content in config: ${memoryContent.substring(0, 200)}...`,
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      addItem(
        {
          type: MessageType.ERROR,
          text: `Error refreshing memory: ${errorMessage}`,
        },
        Date.now(),
      );
      debugLogger.error('Error refreshing memory:', error);
    }
  }, [config, addItem]);
}

function useModelChangeWatcher(
  config: Config,
  sessionState: SessionState,
  historyLength: number,
  dispatch: React.Dispatch<SessionAction>,
  warningTimerRef: React.MutableRefObject<NodeJS.Timeout | null>,
): void {
  useEffect(() => {
    const currentTimerRef = warningTimerRef;
    const checkModelChange = () => {
      const runtime = getRuntimeApi();
      const status = runtime.getActiveProviderStatus();
      const displayModel =
        status.providerName && status.modelName
          ? `${status.providerName}:${status.modelName}`
          : (status.modelName ?? config.getModel());
      if (displayModel !== sessionState.currentModel) {
        dispatch({ type: 'SET_CURRENT_MODEL', payload: displayModel });
      }
      const paymentMode = status.isPaidMode;
      if (paymentMode === sessionState.isPaidMode) return;
      dispatch({ type: 'SET_PAID_MODE', payload: paymentMode });
      const paymentModeJustChanged =
        paymentMode !== undefined &&
        sessionState.isPaidMode !== undefined &&
        historyLength > 0;
      if (!paymentModeJustChanged) return;
      if (status.providerName === 'gemini') {
        const warning =
          paymentMode === true
            ? `! PAID MODE: You are now using Gemini with API credentials - usage will be charged to your account`
            : `FREE MODE: You are now using Gemini with OAuth authentication - no charges will apply`;
        dispatch({ type: 'SET_TRANSIENT_WARNINGS', payload: [warning] });
      }
      scheduleWarningClear(currentTimerRef, dispatch);
    };
    checkModelChange();
    const interval = setInterval(checkModelChange, 1000);
    return () => {
      clearInterval(interval);
      if (currentTimerRef.current) clearTimeout(currentTimerRef.current);
    };
  }, [
    config,
    sessionState.currentModel,
    sessionState.isPaidMode,
    historyLength,
    dispatch,
    warningTimerRef,
  ]);
}

const SessionControllerInner: React.FC<SessionControllerProps> = ({
  children,
  config,
}) => {
  const [sessionState, dispatch] = useSessionState();
  const [appState, appDispatch] = useReducer(appReducer, initialAppState);
  const { history, addItem, updateItem, clearItems, loadHistory } =
    useHistory();
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

  const checkPaymentModeChange = useCheckPaymentModeChange(
    sessionState,
    history.length,
    dispatch,
    warningTimerRef,
  );
  const performMemoryRefresh = usePerformMemoryRefresh(config, addItem);
  useModelChangeWatcher(
    config,
    sessionState,
    history.length,
    dispatch,
    warningTimerRef,
  );

  useEffect(() => {
    if (appState.lastAddItemAction) {
      const { itemData, baseTimestamp } = appState.lastAddItemAction;
      addItem(itemData, baseTimestamp);
    }
  }, [appState.lastAddItemAction, addItem]);

  const contextValue = useMemo(
    () => ({
      history,
      addItem,
      updateItem,
      clearItems,
      loadHistory,
      sessionState,
      dispatch,
      appState,
      appDispatch,
      checkPaymentModeChange,
      performMemoryRefresh,
    }),
    [
      history,
      addItem,
      updateItem,
      clearItems,
      loadHistory,
      sessionState,
      dispatch,
      appState,
      appDispatch,
      checkPaymentModeChange,
      performMemoryRefresh,
    ],
  );

  return (
    <SessionContext.Provider value={contextValue}>
      <AppDispatchProvider value={appDispatch}>{children}</AppDispatchProvider>
    </SessionContext.Provider>
  );
};

// Re-export the outer SessionController as default
