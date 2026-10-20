/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useResponsive } from '../../../hooks/useResponsive.js';
import type { TerminalStore } from '../../../stores/terminal/terminalStore.js';
import type { SettingsProfileStore } from '../../../stores/settings/settingsStore.js';
import type { TurnStore } from '../../../stores/turn/turnStore.js';
import { useBracketedPaste } from '../../../hooks/useBracketedPaste.js';
import { useConsoleMessages } from '../../../hooks/useConsoleMessages.js';
import { useCoreEventHandlers } from '../../../hooks/useCoreEventHandlers.js';
import {
  DEFAULT_HISTORY_MAX_BYTES,
  DEFAULT_HISTORY_MAX_ITEMS,
} from '../../../../constants/historyLimits.js';
import {
  useRetractableHistory,
  type UseHistoryManagerReturn,
} from '../../../hooks/useHistoryManager.js';
import { useMemoryMonitor } from '../../../hooks/useMemoryMonitor.js';
import type { IContent, IdeInfo } from '@vybestack/llxprt-code-core';
import { useSessionStats } from '../../../contexts/SessionContext.js';
import { useFocus } from '../../../hooks/useFocus.js';
import type { UpdateObject } from '../../../utils/updateCheck.js';
import { useOAuthControl } from '../../../contexts/OAuthControlContext.js';
import { useUpdateAndOAuthBridges } from './useUpdateAndOAuthBridges.js';
import { useSessionInitialization } from './useSessionInitialization.js';
import { useTokenMetricsTracking } from './useTokenMetricsTracking.js';
import type { SessionRecordingEvent } from '@vybestack/llxprt-code-agents';
import type { UseSessionInitializationParams } from './useSessionInitialization.js';
import type { MemoryTelemetryController } from '../../../hooks/memoryTrend/memoryTelemetry.js';

export interface AppBootstrapProps {
  readEmojiFilterMode: UseSessionInitializationParams['readEmojiFilterMode'];
  readLlxprtMdFileCount: () => number;
  readCoreMemoryFileCount: () => number;
  readTerminalBackground: () => string | undefined;
  readCurrentIde: () => IdeInfo | undefined;
  readIdeMode: () => boolean;
  readDebugMode: () => boolean;
  triggerSessionStart: UseSessionInitializationParams['triggerSessionStart'];
  appendHistory: (content: IContent) => Promise<void>;
  recordRecordingEvent: (event: SessionRecordingEvent) => Promise<void>;
  recordFeedback: (
    severity: 'warning' | 'error',
    message: string,
  ) => void | Promise<void>;
  setTokenTrackingMetrics: Parameters<
    typeof useTokenMetricsTracking
  >[0]['setTokenTrackingMetrics'];
  subscribeHistoryTokens: Parameters<
    typeof useTokenMetricsTracking
  >[0]['subscribeHistoryTokens'];
  subscribeRecordingHistory: Parameters<
    typeof useTokenMetricsTracking
  >[0]['subscribeRecordingHistory'];
  readProviderMetrics: Parameters<
    typeof useTokenMetricsTracking
  >[0]['readProviderMetrics'];
  readSessionTokenUsage: Parameters<
    typeof useTokenMetricsTracking
  >[0]['readSessionTokenUsage'];
  historyMaxItems?: number;
  historyMaxBytes?: number;
  hasSeenIdeIntegrationNudge?: boolean;
  resumedHistory?: IContent[];
  version: string;
  /** P12: optional memory telemetry controller (perf+memory enabled only). */
  memoryController?: MemoryTelemetryController;
  /** Terminal store; bootstrap owns the focus/narrow writer effects. */
  terminalStore: TerminalStore;
  /** Settings/profile store; bootstrap mirrors session context readouts. */
  settingsStore: SettingsProfileStore;
  /**
   * Turn store owning history and streamed-turn state; bootstrap binds the
   * history commands and applies the history display limits.
   */
  turnStore: TurnStore;
}

export interface AppBootstrapResult {
  setLlxprtMdFileCount: (count: number) => void;
  handleNewMessage: ReturnType<typeof useConsoleMessages>['handleNewMessage'];
  clearConsoleMessagesState: ReturnType<
    typeof useConsoleMessages
  >['clearConsoleMessages'];
  setIdePromptAnswered: React.Dispatch<React.SetStateAction<boolean>>;
  currentIDE: IdeInfo | undefined;
  shouldShowIdePrompt: boolean | null | undefined;
  updateInfo: UpdateObject | null;
  nightly: boolean;
  recordRecordingEvent: AppBootstrapProps['recordRecordingEvent'];
}

function useInitializationBindings(
  triggerSessionStart: AppBootstrapProps['triggerSessionStart'],
  appendHistory: AppBootstrapProps['appendHistory'],
  readEmojiFilterMode: AppBootstrapProps['readEmojiFilterMode'],
  readLlxprtMdFileCount: AppBootstrapProps['readLlxprtMdFileCount'],
  readCoreMemoryFileCount: AppBootstrapProps['readCoreMemoryFileCount'],
) {
  return {
    triggerSessionStart,
    appendHookContext: useCallback(
      async (text: string) => {
        await appendHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text }],
        });
      },
      [appendHistory],
    ),
    readEmojiFilterMode,
    readLlxprtMdFileCount,
    readCoreMemoryFileCount,
  };
}

/** Initializes history, session, and IO primitives */
function useBootstrapHistory(props: AppBootstrapProps) {
  const { resumedHistory, historyMaxItems, historyMaxBytes } = props;
  const isFocused = useFocus();
  const { isNarrow } = useResponsive();
  useBracketedPaste();
  // Focus and narrow-width detection stay here (they own the effects and
  // platform reads); the values move to the TerminalStore via writer effects.
  useEffect(() => {
    props.terminalStore.commands.setFocus(isFocused);
  }, [props.terminalStore, isFocused]);
  useEffect(() => {
    props.terminalStore.commands.setNarrow(isNarrow);
  }, [props.terminalStore, isNarrow]);
  // The background color is not reactive upstream; re-sync after each render
  // so theme switches propagate. The command guards equal writes.
  useEffect(() => {
    props.terminalStore.commands.setTerminalBackgroundColor(
      props.readTerminalBackground(),
    );
  });
  const [updateInfo, setUpdateInfo] = useState<UpdateObject | null>(null);
  const nightly = props.version.includes('nightly');
  const historyLimits = useMemo(
    () => ({
      maxItems:
        typeof historyMaxItems === 'number'
          ? historyMaxItems
          : DEFAULT_HISTORY_MAX_ITEMS,
      maxBytes:
        typeof historyMaxBytes === 'number'
          ? historyMaxBytes
          : DEFAULT_HISTORY_MAX_BYTES,
    }),
    [historyMaxItems, historyMaxBytes],
  );
  const { addItem, loadHistory } = useRetractableHistory(
    props.turnStore,
    historyLimits,
  );
  const {
    llxprtMdFileCount,
    setLlxprtMdFileCount,
    coreMemoryFileCount,
    setCoreMemoryFileCount: _setCoreMemoryFileCount,
  } = useSessionInitialization({
    ...useInitializationBindings(
      props.triggerSessionStart,
      props.appendHistory,
      props.readEmojiFilterMode,
      props.readLlxprtMdFileCount,
      props.readCoreMemoryFileCount,
    ),
    addItem,
    loadHistory,
    resumedHistory,
  });
  // Store mirrors: the context summary renders from the settings store.
  useEffect(() => {
    props.settingsStore.commands.setLlxprtMdFileCount(llxprtMdFileCount);
  }, [props.settingsStore, llxprtMdFileCount]);
  useEffect(() => {
    props.settingsStore.commands.setCoreMemoryFileCount(coreMemoryFileCount);
  }, [props.settingsStore, coreMemoryFileCount]);
  useMemoryMonitor({ addItem, memoryController: props.memoryController });
  return {
    updateInfo,
    setUpdateInfo,
    nightly,
    addItem,
    setLlxprtMdFileCount,
  };
}

function useMirroredTokenMetrics(
  settingsStore: SettingsProfileStore,
  tokenMetrics: ReturnType<typeof useTokenMetricsTracking>['tokenMetrics'],
  historyTokenCount: number,
): void {
  useEffect(() => {
    settingsStore.commands.setTokenMetrics(tokenMetrics);
  }, [settingsStore, tokenMetrics]);
  useEffect(() => {
    settingsStore.commands.setHistoryTokenCount(historyTokenCount);
  }, [settingsStore, historyTokenCount]);
}

/** Initializes recording, IDE prompt, messages, and token metrics */
function useBootstrapEvents(
  props: AppBootstrapProps,
  addItem: UseHistoryManagerReturn['addItem'],
  setUpdateInfo: React.Dispatch<React.SetStateAction<UpdateObject | null>>,
) {
  const oauthControl = useOAuthControl();
  const [idePromptAnswered, setIdePromptAnswered] = useState(false);
  const currentIDE = props.readCurrentIde();
  const shouldShowIdePrompt =
    Boolean(currentIDE) &&
    !props.readIdeMode() &&
    props.hasSeenIdeIntegrationNudge !== true &&
    !idePromptAnswered;
  useUpdateAndOAuthBridges({
    addItem,
    setUpdateInfo,
    oauthControl,
  });
  const {
    consoleMessages,
    handleNewMessage,
    clearConsoleMessages: clearConsoleMessagesState,
  } = useConsoleMessages();
  useCoreEventHandlers({
    handleNewMessage,
    readDebugMode: props.readDebugMode,
    recordFeedback: props.recordFeedback,
  });
  const { stats: sessionStats, updateHistoryTokenCount } = useSessionStats();
  const { tokenMetrics } = useTokenMetricsTracking({
    setTokenTrackingMetrics: props.setTokenTrackingMetrics,
    subscribeHistoryTokens: props.subscribeHistoryTokens,
    subscribeRecordingHistory: props.subscribeRecordingHistory,
    readProviderMetrics: props.readProviderMetrics,
    readSessionTokenUsage: props.readSessionTokenUsage,
    updateHistoryTokenCount,
  });
  useMirroredTokenMetrics(
    props.settingsStore,
    tokenMetrics,
    sessionStats.historyTokenCount,
  );
  return {
    setIdePromptAnswered,
    currentIDE,
    shouldShowIdePrompt,
    consoleMessages,
    handleNewMessage,
    clearConsoleMessagesState,
  };
}

export function useAppBootstrap(props: AppBootstrapProps): AppBootstrapResult {
  const h = useBootstrapHistory(props);
  const e = useBootstrapEvents(props, h.addItem, h.setUpdateInfo);
  useEffect(() => {
    props.settingsStore.commands.setRawConsoleMessages(e.consoleMessages);
  }, [props.settingsStore, e.consoleMessages]);
  return {
    recordRecordingEvent: props.recordRecordingEvent,
    nightly: h.nightly,
    setLlxprtMdFileCount: h.setLlxprtMdFileCount,
    updateInfo: h.updateInfo,
    setIdePromptAnswered: e.setIdePromptAnswered,
    currentIDE: e.currentIDE,
    shouldShowIdePrompt: e.shouldShowIdePrompt,
    handleNewMessage: e.handleNewMessage,
    clearConsoleMessagesState: e.clearConsoleMessagesState,
  };
}
