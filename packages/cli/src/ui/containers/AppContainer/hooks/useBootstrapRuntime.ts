/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { appendJournalUiItem } from '../../../hooks/command-journal-output.js';
import { useCallback, useMemo } from 'react';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { EmojiFilterSettingsSource } from '../../../utils/iContentToHistoryItems.js';
import { resolveEmojiFilterMode } from '../../../utils/iContentToHistoryItems.js';
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
  | 'resumedBoot'
  | 'readJournal'
  | 'settings'
  | 'readRecordingPath'
  | 'version'
  | 'memoryController'
  | 'readIdeMode'
>;

/**
 * The runtime reads bootstrap setup makes: the emoji-filter setting, the
 * terminal background, the debug flag, and the current IDE the input path
 * reports.
 */
export interface BootstrapRuntimeReads {
  readonly emojiFilter: EmojiFilterSettingsSource;
  getTerminalBackground(): string | undefined;
  getDebugMode(): boolean;
  readonly readCurrentIde: AppBootstrapProps['readCurrentIde'];
}

function useBootstrapReads(reads: BootstrapRuntimeReads) {
  const { emojiFilter, getTerminalBackground, getDebugMode, readCurrentIde } =
    reads;
  return {
    readEmojiFilterMode: useCallback(
      () => resolveEmojiFilterMode(emojiFilter),
      [emojiFilter],
    ),
    readTerminalBackground: useCallback(
      () => getTerminalBackground(),
      [getTerminalBackground],
    ),
    readCurrentIde,
    readDebugMode: useCallback(() => getDebugMode(), [getDebugMode]),
  };
}

export function useBootstrapRuntime(
  inputs: BootstrapInputs,
  settings: LoadedSettings['merged'],
  stores: Pick<
    AppBootstrapProps,
    'terminalStore' | 'turnStore' | 'settingsStore'
  >,
  reads: BootstrapRuntimeReads,
  connectRecordingHistory: RecordingHistorySubscription,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegrationRef:
    | React.MutableRefObject<RecordingIntegration | null>
    | undefined,
): AppBootstrapResult {
  const { recordRecordingEvent, readJournal } = inputs;
  return useAppBootstrap({
    ...inputs,
    terminalStore: stores.terminalStore,
    turnStore: stores.turnStore,
    settingsStore: stores.settingsStore,
    hasSeenIdeIntegrationNudge: settings.hasSeenIdeIntegrationNudge,
    ...useBootstrapReads(reads),
    recordFeedback: useCallback(
      async (severity, message) => {
        await appendJournalUiItem(readJournal(), undefined, {
          type: severity,
          text: message,
        });
        if (severity === 'info') return undefined;
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
      [
        recordRecordingEvent,
        recordingOwner,
        recordingIntegrationRef,
        readJournal,
      ],
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
