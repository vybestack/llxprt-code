/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useRef } from 'react';
import {
  type Config,
  type CompletedToolCall,
  type EditorType,
  type GeminiClient,
  type MessageBus,
  type ToolCallRequestInfo,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import {
  MessageType,
  StreamingState,
  type HistoryItemWithoutId,
} from '../../types.js';
import { useShellCommandProcessor } from '../shellCommandProcessor.js';
import {
  type TrackedCancelledToolCall,
  type TrackedCompletedToolCall,
  type TrackedToolCall,
  useReactToolScheduler,
} from '../useReactToolScheduler.js';
import { mapToDisplay as mapTrackedToolCallsToDisplay } from '../toolMapping.js';
import { useKeypress, type Key } from '../useKeypress.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import { type QueuedSubmission } from './types.js';

export function useStreamingState(
  isResponding: boolean,
  toolCalls: TrackedToolCall[],
): StreamingState {
  return useMemo(() => {
    if (toolCalls.some((tc) => tc.status === 'awaiting_approval')) {
      return StreamingState.WaitingForConfirmation;
    }
    if (isResponding || toolCalls.some(isOutstandingToolCall)) {
      return StreamingState.Responding;
    }
    return StreamingState.Idle;
  }, [isResponding, toolCalls]);
}

function isOutstandingToolCall(tc: TrackedToolCall): boolean {
  const status = tc.status;
  if (isActiveToolCall(status)) return true;
  if (!isTerminalToolCall(status)) return false;
  return (
    (tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
      .responseSubmittedToGemini !== true
  );
}

function isActiveToolCall(status: TrackedToolCall['status']): boolean {
  return (
    status === 'executing' || status === 'scheduled' || status === 'validating'
  );
}

function isTerminalToolCall(status: TrackedToolCall['status']): boolean {
  return status === 'success' || status === 'error' || status === 'cancelled';
}

export function useToolSchedulerSetup(
  config: Config,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  getPreferredEditor: () => EditorType | undefined,
  onEditorClose: () => void,
  onEditorOpen: () => void,
  runtimeMessageBus: MessageBus | undefined,
  addItem: UseHistoryManagerReturn['addItem'],
  geminiClient: GeminiClient,
) {
  const handleCompletedToolsRef = useRef<
    (tools: TrackedToolCall[]) => Promise<void>
  >(async () => {});

  const toolSchedulerResult = useReactToolScheduler(
    async (_schedulerId, completedToolCallsFromScheduler, { isPrimary }) => {
      if (completedToolCallsFromScheduler.length === 0) return;
      if (isPrimary) {
        void processPrimaryCompletion(
          completedToolCallsFromScheduler,
          addItem,
          geminiClient,
          config,
          handleCompletedToolsRef.current,
        );
        return;
      }
      processSecondaryCompletion(
        completedToolCallsFromScheduler,
        toolSchedulerResult[2],
        addItem,
      );
    },
    config,
    setPendingHistoryItem,
    getPreferredEditor,
    onEditorClose,
    onEditorOpen,
    runtimeMessageBus,
  );

  return { toolSchedulerResult, handleCompletedToolsRef };
}

async function processPrimaryCompletion(
  completedToolCallsFromScheduler: TrackedToolCall[],
  addItem: UseHistoryManagerReturn['addItem'],
  geminiClient: GeminiClient,
  config: Config,
  handleCompletedTools: (tools: TrackedToolCall[]) => Promise<void>,
): Promise<void> {
  addItem(
    mapTrackedToolCallsToDisplay(completedToolCallsFromScheduler),
    Date.now(),
  );
  try {
    const currentModel =
      geminiClient.getCurrentSequenceModel() ?? config.getModel();
    geminiClient
      .getChat()
      .recordCompletedToolCalls(
        currentModel,
        completedToolCallsFromScheduler as CompletedToolCall[],
      );
  } catch (error) {
    debugLogger.error(
      `Error recording completed tool call information: ${error}`,
    );
  }
  await handleCompletedTools(completedToolCallsFromScheduler);
}

function processSecondaryCompletion(
  completedToolCallsFromScheduler: TrackedToolCall[],
  markToolsAsSubmitted: (callIds: string[]) => void,
  addItem: UseHistoryManagerReturn['addItem'],
): void {
  const callIdsToMark = completedToolCallsFromScheduler.map(
    (toolCall) => toolCall.request.callId,
  );
  if (callIdsToMark.length > 0) markToolsAsSubmitted(callIdsToMark);
  addItem(
    mapTrackedToolCallsToDisplay(completedToolCallsFromScheduler),
    Date.now(),
  );
}

export function useShellCommandSetup({
  addItem,
  setPendingHistoryItem,
  setIsResponding,
  onDebugMessage,
  config,
  geminiClient,
  setShellInputFocused,
  terminalWidth,
  terminalHeight,
  pendingHistoryItemRef,
}: {
  addItem: UseHistoryManagerReturn['addItem'];
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  setIsResponding: React.Dispatch<React.SetStateAction<boolean>>;
  onDebugMessage: (message: string) => void;
  config: Config;
  geminiClient: GeminiClient;
  setShellInputFocused: (value: boolean) => void;
  terminalWidth?: number;
  terminalHeight?: number;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
}) {
  const onExec = useCallback(
    async (done: Promise<void>) => {
      setIsResponding(true);
      await done;
      setIsResponding(false);
    },
    [setIsResponding],
  );
  return useShellCommandProcessor(
    addItem,
    setPendingHistoryItem,
    onExec,
    onDebugMessage,
    config,
    geminiClient,
    setShellInputFocused,
    terminalWidth,
    terminalHeight,
    pendingHistoryItemRef,
  );
}

export function useCancellation(
  streamingState: StreamingState,
  turnCancelledRef: React.MutableRefObject<boolean>,
  abortControllerRef: React.MutableRefObject<AbortController | null>,
  cancelAllToolCalls: () => void,
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>,
  flushPendingHistoryItem: (timestamp: number) => void,
  addItem: (item: HistoryItemWithoutId, timestamp: number) => number,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  onCancelSubmit: (shouldRestorePrompt?: boolean) => void,
  setIsResponding: React.Dispatch<React.SetStateAction<boolean>>,
  queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]>,
) {
  const cancelOngoingRequest = useCallback(() => {
    if (streamingState !== StreamingState.Responding) return;
    if (turnCancelledRef.current) return;
    turnCancelledRef.current = true;
    abortControllerRef.current?.abort();
    if (abortControllerRef.current) cancelAllToolCalls();
    if (pendingHistoryItemRef.current) flushPendingHistoryItem(Date.now());
    addItem({ type: MessageType.INFO, text: 'Request cancelled.' }, Date.now());
    setPendingHistoryItem(null);
    onCancelSubmit();
    setIsResponding(false);
    queuedSubmissionsRef.current = [];
  }, [
    streamingState,
    turnCancelledRef,
    abortControllerRef,
    cancelAllToolCalls,
    pendingHistoryItemRef,
    flushPendingHistoryItem,
    addItem,
    setPendingHistoryItem,
    onCancelSubmit,
    setIsResponding,
    queuedSubmissionsRef,
  ]);
  const cancelOngoingRequestRef = useRef(cancelOngoingRequest);
  cancelOngoingRequestRef.current = cancelOngoingRequest;
  const handleEscapeKeypress = useCallback((key: Key) => {
    const isEscape =
      key.name === 'escape' ||
      key.sequence === '\u001b[27u' ||
      key.sequence === '\u001b';
    if (!isEscape) return;
    cancelOngoingRequestRef.current();
  }, []);
  useKeypress(handleEscapeKeypress, { isActive: true });
  return { cancelOngoingRequest };
}

export type ToolSchedulerResult = ReturnType<typeof useReactToolScheduler>;
export type ScheduleToolCalls = (
  requests: ToolCallRequestInfo[],
  signal: AbortSignal,
) => Promise<void>;
