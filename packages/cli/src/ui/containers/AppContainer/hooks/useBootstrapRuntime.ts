/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useMemo } from 'react';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { UiRuntime } from '../../../cliUiRuntime.js';
import { resolveEmojiFilterMode } from '../../../utils/iContentToHistoryItems.js';
import { useBound } from '../../../hooks/agentStream/useStreamOwnerCallbacks.js';
import type { RecordingHistorySubscription } from './historyTokenSubscriptions.js';
import {
  useAppBootstrap,
  type AppBootstrapProps,
  type AppBootstrapResult,
} from './useAppBootstrap.js';

type BootstrapInputs = Pick<
  AppBootstrapProps,
  | 'subscribeHistoryTokens'
  | 'triggerSessionStart'
  | 'appendHistory'
  | 'recordRecordingEvent'
  | 'setTokenTrackingMetrics'
  | 'readLlxprtMdFileCount'
  | 'readCoreMemoryFileCount'
  | 'readProviderMetrics'
  | 'readSessionTokenUsage'
  | 'resumedHistory'
  | 'version'
  | 'memoryController'
  | 'readIdeMode'
>;

function useBootstrapReads(
  ephemeral: UiRuntime['ephemeral'],
  shell: UiRuntime['shell'],
  readCurrentIde: AppBootstrapProps['readCurrentIde'],
  app: UiRuntime['app'],
) {
  return {
    readEmojiFilterMode: useCallback(
      () => resolveEmojiFilterMode(ephemeral),
      [ephemeral],
    ),
    readTerminalBackground: useBound(shell, shell.getTerminalBackground),
    readCurrentIde,
    readDebugMode: useBound(app, app.getDebugMode),
  };
}

export function useBootstrapRuntime(
  inputs: BootstrapInputs,
  settings: LoadedSettings['merged'],
  stores: Pick<
    AppBootstrapProps,
    'terminalStore' | 'turnStore' | 'settingsStore'
  >,
  ephemeral: UiRuntime['ephemeral'],
  shell: UiRuntime['shell'],
  readCurrentIde: AppBootstrapProps['readCurrentIde'],
  app: UiRuntime['app'],
  connectRecordingHistory: RecordingHistorySubscription,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegrationRef:
    | React.MutableRefObject<RecordingIntegration | null>
    | undefined,
): AppBootstrapResult {
  const recordRecordingEvent = inputs.recordRecordingEvent;
  return useAppBootstrap({
    ...inputs,
    terminalStore: stores.terminalStore,
    turnStore: stores.turnStore,
    settingsStore: stores.settingsStore,
    historyMaxItems: settings.ui.historyMaxItems,
    historyMaxBytes: settings.ui.historyMaxBytes,
    hasSeenIdeIntegrationNudge: settings.hasSeenIdeIntegrationNudge,
    ...useBootstrapReads(ephemeral, shell, readCurrentIde, app),
    recordFeedback: useCallback(
      (severity, message) => {
        if (recordingOwner === 'agent') {
          return recordRecordingEvent({
            type: 'session_event',
            severity,
            message,
          });
        }
        return recordingIntegrationRef?.current?.recordSessionEvent(
          severity,
          message,
        );
      },
      [recordRecordingEvent, recordingOwner, recordingIntegrationRef],
    ),
    subscribeRecordingHistory: useMemo(
      () =>
        bindBootstrapRecordingHistory(
          connectRecordingHistory,
          recordingOwner,
          recordingIntegrationRef,
        ),
      [connectRecordingHistory, recordingOwner, recordingIntegrationRef],
    ),
  });
}

export function bindBootstrapRecordingHistory(
  connectRecordingHistory: RecordingHistorySubscription,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegrationRef:
    | React.MutableRefObject<RecordingIntegration | null>
    | undefined,
): () => () => void {
  return () => {
    if (recordingOwner === 'agent' || !recordingIntegrationRef?.current)
      return () => {};
    return connectRecordingHistory(recordingIntegrationRef);
  };
}
