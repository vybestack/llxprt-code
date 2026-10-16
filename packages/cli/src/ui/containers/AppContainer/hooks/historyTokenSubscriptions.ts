/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';

type HistorySource = Parameters<
  RecordingIntegration['onHistoryServiceReplaced']
>[0];
export type HistoryTokenSubscription = (
  publish: (count: number) => void,
) => () => void;
export type RecordingHistorySubscription = (
  recording: React.MutableRefObject<RecordingIntegration | null>,
) => () => void;

export function bindHistoryTokenSubscription(
  readHistory: () => HistorySource | null,
  tokenLogger: DebugLogger,
): HistoryTokenSubscription {
  return (publish) => {
    let retired = false;
    let current: HistorySource | null = null;
    let stop: (() => void) | null = null;
    let lastPublished: number | null = null;
    const interval = setInterval(() => {
      if (retired) return;
      const history = readHistory();
      if (history === current) return;
      stop?.();
      stop = null;
      current = history;
      if (history) {
        tokenLogger.debug(
          () => 'Found new history service, setting up listener',
        );
        const changed = (event: { totalTokens: number }) => {
          tokenLogger.debug(
            () =>
              `Received tokensUpdated event: totalTokens=${event.totalTokens}`,
          );
          if (event.totalTokens !== lastPublished) {
            lastPublished = event.totalTokens;
            publish(event.totalTokens);
          }
        };
        history.on('tokensUpdated', changed);
        lastPublished = history.getTotalTokens();
        tokenLogger.debug(() => `Initial token count: ${lastPublished}`);
        publish(lastPublished);
        stop = () => {
          history.off('tokensUpdated', changed);
        };
      } else {
        tokenLogger.debug(() => 'History service reset to undefined');
      }
    }, 100);
    return () => {
      clearInterval(interval);
      retired = true;
      stop?.();
      stop = null;
      current = null;
      lastPublished = null;
    };
  };
}

export function bindRecordingHistorySubscription(
  readHistory: () => HistorySource | null,
  tokenLogger: DebugLogger,
): RecordingHistorySubscription {
  return (recording) => {
    let retired = false;
    let current: HistorySource | null = null;
    const interval = setInterval(() => {
      if (retired) return;
      const history = readHistory();
      if (history === null || history === current) return;
      current = history;
      recording.current?.onHistoryServiceReplaced(history);
      tokenLogger.debug('RecordingIntegration subscribed to HistoryService');
    }, 100);
    return () => {
      clearInterval(interval);
      retired = true;
      current = null;
    };
  };
}
