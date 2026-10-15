/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Manages the agent stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
 *
 * @plan:PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines 100-108
 */

import { useCallback, useMemo } from 'react';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from '../../utils/modelIdentity.js';
import {
  type EditorType,
  type MessageBus,
  type RecordingIntegration,
  type AgentRequestInput,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { type LoadedSettings } from '../../../config/settings.js';
import {
  type HistoryItem,
  type HistoryItemWithoutId,
  type SlashCommandProcessorResult,
} from '../../types.js';
import {
  type RemoveHistoryItems,
  type UseHistoryManagerReturn,
} from '../useHistoryManager.js';
import { mergePendingToolGroupsForDisplay } from './streamUtils.js';
import { useCheckpointPersistence } from './checkpointPersistence.js';
import type { useStreamState } from './useStreamState.js';
import type { AgentStreamOrchestrationDeps } from './useAgentStreamOrchestration.js';
import { useAgentStreamOrchestration } from './useAgentStreamOrchestration.js';
import type { StreamRuntime, UiSubagentManager } from '../../cliUiRuntime.js';
import type { OperationLifecycleRegistry } from './operationLifecycle.js';

export interface StreamInteractionInputs {
  history: HistoryItem[];
  addItem: UseHistoryManagerReturn['addItem'];
  settings: LoadedSettings;
  onDebugMessage: (message: string) => void;
  handleSlashCommand: (
    cmd: AgentRequestInput,
  ) => Promise<SlashCommandProcessorResult | false>;
  shellModeActive: boolean;
  getPreferredEditor: () => EditorType | undefined;
  onAuthError: () => void;
  performMemoryRefresh: () => Promise<void>;
  onEditorClose: () => void;
  onCancelSubmit: (shouldRestorePrompt?: boolean) => void;
  setShellInputFocused: (value: boolean) => void;
  terminalWidth?: number;
  terminalHeight?: number;
  onEditorOpen?: () => void;
  removeItems?: RemoveHistoryItems;
  operationLifecycle?: OperationLifecycleRegistry;
  cancelActiveSlashCommand?: () => boolean;
}

export const useAgentStream = (
  agent: Agent,
  runtime: StreamRuntime,
  input: StreamInteractionInputs,
  recordingIntegration?: RecordingIntegration,
  runtimeMessageBus?: MessageBus,
  subagentManager?: UiSubagentManager,
  recordingOwner?: 'agent' | 'raw',
) => {
  const { tools, mcp, metrics, tasks } = agent;
  const orchestration = useAgentStreamOrchestration({
    ...input,
    onEditorOpen: input.onEditorOpen ?? (() => {}),
    stream: useMemo(() => agent.stream.bind(agent), [agent]),
    setDisplayCallbacks: useMemo(
      () => tools.setDisplayCallbacks.bind(tools),
      [tools],
    ),
    setEditorCallbacks: useMemo(
      () => tools.setEditorCallbacks.bind(tools),
      [tools],
    ),
    openClientChannel: useMemo(
      () => tools.openClientChannel.bind(tools),
      [tools],
    ),
    subscribeChildTools: useMemo(
      () => tools.subscribeChildTools.bind(tools),
      [tools],
    ),
    appendShellHistory: useMemo(() => agent.addHistory.bind(agent), [agent]),
    injectSteer: useMemo(() => agent.injectSteer.bind(agent), [agent]),
    cancelRunningAsyncTasks: useCancelRunningSubagents(tasks),
    getProviderContextLimit: useMemo(
      () => agent.getProviderContextLimit.bind(agent),
      [agent],
    ),
    getContentPrefixIdentity: useContentIdentityReader(agent),
    getToolHandle: useMemo(() => tools.get.bind(tools), [tools]),
    findResource: useMemo(() => mcp.findResource.bind(mcp), [mcp]),
    readResource: useMemo(() => mcp.readResource.bind(mcp), [mcp]),
    setLastPromptTokenCount: useMemo(
      () => metrics.setLastPromptTokenCount.bind(metrics),
      [metrics],
    ),
    subscribeTaskNotifications: useMemo(
      () => tasks.subscribeNotifications.bind(tasks),
      [tasks],
    ),
    flushRecording: useTurnRecordingFlush(
      agent.session,
      recordingOwner,
      recordingIntegration,
    ),
    runtime,
    runtimeMessageBus,
    subagentManager,
  } satisfies AgentStreamOrchestrationDeps);

  return useAgentStreamReturn(
    orchestration,
    runtime,
    input.history,
    agent,
    input.onDebugMessage,
  );
};

function useAgentStreamReturn(
  orchestration: ReturnType<typeof useAgentStreamOrchestration>,
  runtime: StreamRuntime,
  history: HistoryItem[],
  agent: Agent,
  onDebugMessage: (message: string) => void,
) {
  const pendingHistoryItems = usePendingHistoryItems(
    orchestration.st,
    orchestration.pendingToolCallGroupDisplay,
  );

  const readHistory = useCallback(() => agent.getHistory(), [agent]);
  const checkpoint = runtime.checkpoint;
  const isCheckpointingEnabled = useCallback(
    () => checkpoint.getCheckpointingEnabled(),
    [checkpoint],
  );
  useCheckpointPersistence(
    orchestration.toolCalls,
    isCheckpointingEnabled,
    orchestration.st.gitService,
    history,
    readHistory,
    runtime.projectCheckpointsDir,
    onDebugMessage,
  );

  return {
    streamingState: orchestration.streamingState,
    submitQuery: orchestration.submitQuery,
    sanitizeContent: orchestration.st.sanitizeContent,
    initError: orchestration.st.initError,
    pendingHistoryItems,
    thought: orchestration.st.thought,
    interactiveRuntimeReady: orchestration.interactiveRuntimeReady,
    cancelOngoingRequest: orchestration.cancelOngoingRequest,
    activeShellPtyId: orchestration.activeShellPtyId,
    lastOutputTime: getLastOutputTime(orchestration),
    queuedSubmissions: orchestration.queuedSubmissions,
    clearQueuedSubmissions: orchestration.st.clearSubmissions,
    sendAllQueuedSubmissions: orchestration.sendAllQueuedSubmissions,
    steerAllQueuedSubmissions: orchestration.steerAllQueuedSubmissions,
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
}: ReturnType<typeof useAgentStreamOrchestration>): number {
  return Math.max(
    lastToolOutputTime,
    lastShellOutputTime,
    st.lastAgentActivityTime,
  );
}

function defaultGetContentPrefixIdentity(
  identity: Parameters<typeof createCliModelIdentityRuntime>[0],
): string | null {
  try {
    return resolveContentPrefixIdentity(
      createCliModelIdentityRuntime(identity),
    );
  } catch {
    return null;
  }
}

function useCancelRunningSubagents(
  tasks: Pick<Agent['tasks'], 'listRunning' | 'cancel'>,
): () => void {
  return useCallback(() => {
    for (const task of tasks.listRunning()) {
      if (task.kind === 'subagent') void tasks.cancel(task.id);
    }
  }, [tasks]);
}

function useContentIdentityReader(
  identity: Parameters<typeof createCliModelIdentityRuntime>[0],
): () => string | null {
  return useCallback(
    () => defaultGetContentPrefixIdentity(identity),
    [identity],
  );
}

function useTurnRecordingFlush(
  session: Pick<Agent['session'], 'flushRecording'>,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegration:
    | Pick<RecordingIntegration, 'flushAtTurnBoundary'>
    | undefined,
): () => Promise<void> {
  return useCallback(async () => {
    if (recordingOwner === 'agent') {
      await session.flushRecording();
      return;
    }
    try {
      await recordingIntegration?.flushAtTurnBoundary();
    } catch {
      /* non-fatal */
    }
  }, [session, recordingOwner, recordingIntegration]);
}
