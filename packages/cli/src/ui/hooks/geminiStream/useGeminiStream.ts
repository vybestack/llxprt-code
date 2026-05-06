/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

/**
 * Manages the Gemini stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
 *
 * @plan:PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines 100-108
 */

import { useMemo } from 'react';
import {
  type Config,
  type GeminiClient,
  type EditorType,
  type ThinkingBlock,
  type MessageBus,
  type RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import { type PartListUnion } from '@google/genai';
import { type LoadedSettings } from '../../../config/settings.js';
import {
  type HistoryItem,
  type HistoryItemWithoutId,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import { mergePendingToolGroupsForDisplay } from './streamUtils.js';
import { useCheckpointPersistence } from './checkpointPersistence.js';
import type { useStreamState } from './useStreamState.js';
import type { GeminiStreamOrchestrationDeps } from './useGeminiStreamOrchestration.js';
import { useGeminiStreamOrchestration } from './useGeminiStreamOrchestration.js';

/**
 * Resets or carries-over per-turn state depending on whether this is a new
 * prompt or a continuation. Also handles bucket failover reset/reauth.
 */
export async function prepareTurnForQuery(
  isContinuation: boolean,
  config: Config,
  startNewPrompt: () => void,
  setThought: (t: null) => void,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
): Promise<void> {
  const getBucketFailoverHandler = config.getBucketFailoverHandler as
    | Config['getBucketFailoverHandler']
    | undefined;

  if (!isContinuation) {
    startNewPrompt();
    setThought(null);
    thinkingBlocksRef.current = [];
    getBucketFailoverHandler?.()?.reset?.();

    // Invalidate auth cache at turn boundaries for new turns
    // This ensures tokens updated by other processes are picked up
    const handler = getBucketFailoverHandler?.();
    if (handler?.invalidateAuthCache) {
      const getRuntimeSessionId = config.getSessionId as
        | (() => string | undefined)
        | undefined;
      const runtimeId = getRuntimeSessionId?.() ?? 'default';
      handler.invalidateAuthCache(runtimeId);
    }
  } else {
    getBucketFailoverHandler?.()?.resetSession?.();
  }
  try {
    await getBucketFailoverHandler?.()?.ensureBucketsAuthenticated?.();
  } catch {
    // Swallow — partial auth is acceptable.
  }
}

export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  settings: LoadedSettings,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
  onEditorClose: () => void,
  onCancelSubmit: (shouldRestorePrompt?: boolean) => void,
  setShellInputFocused: (value: boolean) => void,
  terminalWidth?: number,
  terminalHeight?: number,
  onTodoPause?: () => void,
  onEditorOpen: () => void = () => {},
  recordingIntegration?: RecordingIntegration,
  runtimeMessageBus?: MessageBus,
) => {
  const orchestration = useGeminiStreamOrchestration({
    geminiClient,
    addItem,
    config,
    settings,
    onDebugMessage,
    handleSlashCommand,
    shellModeActive,
    getPreferredEditor,
    onAuthError,
    performMemoryRefresh,
    onEditorClose,
    onCancelSubmit,
    setShellInputFocused,
    terminalWidth,
    terminalHeight,
    onTodoPause,
    onEditorOpen,
    recordingIntegration,
    runtimeMessageBus,
  } satisfies GeminiStreamOrchestrationDeps);

  return useGeminiStreamReturn(
    orchestration,
    config,
    history,
    geminiClient,
    onDebugMessage,
  );
};

function useGeminiStreamReturn(
  orchestration: ReturnType<typeof useGeminiStreamOrchestration>,
  config: Config,
  history: HistoryItem[],
  geminiClient: GeminiClient,
  onDebugMessage: (message: string) => void,
) {
  const pendingHistoryItems = usePendingHistoryItems(
    orchestration.st,
    orchestration.pendingToolCallGroupDisplay,
  );

  useCheckpointPersistence(
    orchestration.toolCalls,
    config,
    orchestration.st.gitService,
    history,
    geminiClient,
    config.storage,
    onDebugMessage,
  );

  return {
    streamingState: orchestration.streamingState,
    submitQuery: orchestration.submitQuery,
    initError: orchestration.st.initError,
    pendingHistoryItems,
    thought: orchestration.st.thought,
    cancelOngoingRequest: orchestration.cancelOngoingRequest,
    activeShellPtyId: orchestration.activeShellPtyId,
    lastOutputTime: getLastOutputTime(orchestration),
  };
}

function usePendingHistoryItems(
  st: ReturnType<typeof useStreamState>,
  pendingToolCallGroupDisplay: HistoryItemWithoutId | undefined,
) {
  return useMemo(
    () =>
      mergePendingToolGroupsForDisplay(
        st.pendingHistoryItem,
        pendingToolCallGroupDisplay,
      ),
    [st.pendingHistoryItem, pendingToolCallGroupDisplay],
  );
}

function getLastOutputTime({
  lastToolOutputTime,
  lastShellOutputTime,
  st,
}: ReturnType<typeof useGeminiStreamOrchestration>): number {
  return Math.max(
    lastToolOutputTime,
    lastShellOutputTime,
    st.lastGeminiActivityTime,
  );
}
