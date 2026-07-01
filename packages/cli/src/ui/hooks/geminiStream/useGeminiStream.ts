/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
  type AgentClientContract,
  type EditorType,
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

export const useGeminiStream = (
  agentClient: AgentClientContract,
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
    agentClient,
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
    agentClient,
    onDebugMessage,
  );
};

function useGeminiStreamReturn(
  orchestration: ReturnType<typeof useGeminiStreamOrchestration>,
  config: Config,
  history: HistoryItem[],
  agentClient: AgentClientContract,
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
    agentClient,
    config.storage,
    onDebugMessage,
  );

  return {
    streamingState: orchestration.streamingState,
    submitQuery: orchestration.submitQuery,
    initError: orchestration.st.initError,
    pendingHistoryItems,
    thought: orchestration.st.thought,
    interactiveRuntimeReady: orchestration.interactiveRuntimeReady,
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
