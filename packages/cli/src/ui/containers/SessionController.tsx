/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GetActiveProfileNameOperation,
  type GetLoadBalancerStatsOperation,
  type ProviderStatusOperation,
  useGetActiveProfileName,
  useGetLoadBalancerStats,
  useProviderStatus,
} from '../contexts/RuntimeContext.js';

import type React from 'react';
import {
  createContext,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useReducer,
} from 'react';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import { useHistory } from '../hooks/useHistoryManager.js';

import {
  getErrorMessage,
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { resolveModelIdentity } from '../utils/modelIdentity.js';
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
import { useStoreSelector } from '../stores/useStoreSelector.js';
import { createTurnStore, type TurnStore } from '../stores/turn/turnStore.js';

// Context type
export interface SessionContextType {
  addItem: (itemData: HistoryItemWithoutId, baseTimestamp?: number) => number;
  clearItems: () => void;
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

/**
 * Session reads the controller needs: the model label, a memory refresh on
 * demand, the debug flag that gates the refresh log line, and the model
 * selection subscription that drives change detection.
 */
export interface SessionControllerRuntime {
  getModel(): string;
  refreshMemory(): Promise<{ memoryContent: string; fileCount: number }>;
  getDebugMode(): boolean;
  subscribeModelSelection(listener: () => void): () => void;
}

interface SessionControllerProps {
  children: React.ReactNode;
  config: SessionControllerRuntime;
  /**
   * Turn store owning the history state. Created per instance when not
   * supplied (the composition root owns the app-wide instance).
   */
  turnStore?: TurnStore;
}

export const SessionController: React.FC<SessionControllerProps> = ({
  children,
  config,
  turnStore,
}) => {
  const runtimeGetActiveProfileName = useGetActiveProfileName();
  const runtimeGetLoadBalancerStats = useGetLoadBalancerStats();
  const runtimeProviderStatus = useProviderStatus();
  const statusSnapshot = runtimeProviderStatus();

  const initialState: SessionState = {
    currentModel: resolveModelIdentity(
      {
        providerStatus: runtimeProviderStatus,
        getActiveProfileName: runtimeGetActiveProfileName,
        getLoadBalancerStats: runtimeGetLoadBalancerStats,
      },
      config.getModel(),
    ),
    isPaidMode: statusSnapshot.isPaidMode,
    lastProvider: statusSnapshot.providerName ?? undefined,
    transientWarnings: [],
  };

  return (
    <SessionStateProvider initialState={initialState}>
      <SessionControllerInner {...{ children, config, turnStore }} />
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
  runtimeProviderStatus: ProviderStatusOperation,
  sessionState: SessionState,
  historyLength: number,
  dispatch: React.Dispatch<SessionAction>,
  warningTimerRef: React.MutableRefObject<NodeJS.Timeout | null>,
): (forcePreviousProvider?: string) => void {
  return useCallback(
    (forcePreviousProvider?: string) => {
      const status = runtimeProviderStatus();
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
      runtimeProviderStatus,
      sessionState.isPaidMode,
      sessionState.lastProvider,
      historyLength,
      dispatch,
      warningTimerRef,
    ],
  );
}

function usePerformMemoryRefresh(
  config: SessionControllerRuntime,
  addItem: (itemData: HistoryItemWithoutId, baseTimestamp?: number) => number,
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
      const { memoryContent, fileCount } = await config.refreshMemory();
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
  runtimeGetActiveProfileName: GetActiveProfileNameOperation,
  runtimeGetLoadBalancerStats: GetLoadBalancerStatsOperation,
  runtimeProviderStatus: ProviderStatusOperation,
  config: SessionControllerRuntime,
  sessionState: SessionState,
  historyLength: number,
  dispatch: React.Dispatch<SessionAction>,
  warningTimerRef: React.MutableRefObject<NodeJS.Timeout | null>,
): void {
  useEffect(() => {
    const currentTimerRef = warningTimerRef;
    const checkModelChange = () => {
      const status = runtimeProviderStatus();
      const displayModel = resolveModelIdentity(
        {
          providerStatus: runtimeProviderStatus,
          getActiveProfileName: runtimeGetActiveProfileName,
          getLoadBalancerStats: runtimeGetLoadBalancerStats,
        },
        config.getModel(),
      );
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

    // Event-driven updates replace the former 1-second setInterval polling.
    // These coreEvents fire on model/profile/provider/settings changes.
    const handleChange = () => checkModelChange();
    const releaseModel = config.subscribeModelSelection(handleChange);
    coreEvents.on(CoreEvent.SettingsChanged, handleChange);

    return () => {
      releaseModel();
      coreEvents.off(CoreEvent.SettingsChanged, handleChange);
      if (currentTimerRef.current) clearTimeout(currentTimerRef.current);
    };
  }, [
    runtimeGetActiveProfileName,
    runtimeGetLoadBalancerStats,
    runtimeProviderStatus,
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
  turnStore: turnStoreProp,
}) => {
  const [sessionState, dispatch] = useSessionState();
  const runtimeGetActiveProfileName = useGetActiveProfileName();
  const runtimeGetLoadBalancerStats = useGetLoadBalancerStats();
  const runtimeProviderStatus = useProviderStatus();
  const [appState, appDispatch] = useReducer(appReducer, initialAppState);
  const turnStoreRef = useRef<TurnStore | null>(null);
  const turnStore =
    turnStoreProp ?? (turnStoreRef.current ??= createTurnStore());
  const { addItem, clearItems } = useHistory(turnStore);
  const historyLength = turnStore.commands.getJournalLength();
  const pendingAddRequest = useStoreSelector(
    turnStore.store,
    (state) => state.pendingAddRequest,
  );
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

  const checkPaymentModeChange = useCheckPaymentModeChange(
    runtimeProviderStatus,
    sessionState,
    historyLength,
    dispatch,
    warningTimerRef,
  );
  const performMemoryRefresh = usePerformMemoryRefresh(config, addItem);
  useModelChangeWatcher(
    runtimeGetActiveProfileName,
    runtimeGetLoadBalancerStats,
    runtimeProviderStatus,
    config,
    sessionState,
    historyLength,
    dispatch,
    warningTimerRef,
  );

  // Side-effect channel for out-of-tree add requests (the former appReducer
  // ADD_ITEM action): the request is recorded synchronously on the store and
  // this effect performs the add once the state lands (dispatch -> effect).
  // Preserve appReducer's lastAddItemAction semantics: requests before the
  // consuming effect replace the slot rather than queueing multiple adds.
  useEffect(() => {
    if (!pendingAddRequest) return;
    const request = turnStore.commands.consumePendingAddRequest(
      pendingAddRequest.seq,
    );
    if (request) addItem(request.itemData, request.baseTimestamp);
  }, [pendingAddRequest, addItem, turnStore]);

  const contextValue = useMemo(
    () => ({
      addItem,
      clearItems,
      sessionState,
      dispatch,
      appState,
      appDispatch,
      checkPaymentModeChange,
      performMemoryRefresh,
    }),
    [
      addItem,
      clearItems,
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
