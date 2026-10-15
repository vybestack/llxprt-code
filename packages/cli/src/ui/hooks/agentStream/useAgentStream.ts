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
import { resolveEmojiFilterMode } from '../../utils/iContentToHistoryItems.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from '../../utils/modelIdentity.js';
import {
  type EditorType,
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
  recorder?: RecordingIntegration,
  subagentManager?: UiSubagentManager,
  recordingOwner?: 'agent' | 'raw',
) => {
  const { tools, mcp, metrics, tasks } = agent;
  const { session, events, model } = runtime;
  const { ephemeral, shell, checkpoint, files, projectTempDir } = runtime;
  const { settings: prefs } = runtime;
  const { bucketFailover: buckets, sessionLimits: limits } = runtime;
  const orchestration = useAgentStreamOrchestration({
    ...input,
    onEditorOpen: input.onEditorOpen ?? (() => {}),
    stream: useBound(agent, agent.stream),
    setDisplayCallbacks: useBound(tools, tools.setDisplayCallbacks),
    setEditorCallbacks: useBound(tools, tools.setEditorCallbacks),
    openClientChannel: useBound(tools, tools.openClientChannel),
    subscribeChildTools: useBound(tools, tools.subscribeChildTools),
    appendShellHistory: useBound(agent, agent.addHistory),
    injectSteer: useBound(agent, agent.injectSteer),
    cancelRunningAsyncTasks: useCancelRunningSubagents(tasks),
    getProviderContextLimit: useBound(agent, agent.getProviderContextLimit),
    getContentPrefixIdentity: useContentIdentityReader(agent),
    getToolHandle: useBound(tools, tools.get),
    findResource: useBound(mcp, mcp.findResource),
    readResource: useBound(mcp, mcp.readResource),
    setLastPromptTokenCount: useBound(metrics, metrics.setLastPromptTokenCount),
    subscribeTaskNotifications: useBound(tasks, tasks.subscribeNotifications),
    flushRecording: useTurnFlush(agent.session, recordingOwner, recorder),
    readSessionId: useBound(session, session.getSessionId),
    subscribeMcpUpdates: useBound(events, events.onMcpClientUpdate),
    resetBuckets: useCallback(() => buckets.resetBuckets?.(), [buckets]),
    resetBucketSession: useCallback(
      () => buckets.resetBucketSession?.(),
      [buckets],
    ),
    ensureBucketsAuthenticated: useCallback(async () => {
      await buckets.ensureBucketsAuthenticated?.();
    }, [buckets]),
    atCommandConfig: files,
    logUserPrompt: useBound(prefs, prefs.logUserPrompt),
    getModel: useBound(model, model.getModel),
    getProvider: useBound(model, model.getProvider),
    readSelectedProvider: useBound(prefs, prefs.readSelectedProvider),
    readCitations: useBound(prefs, prefs.readCitations),
    readProfileName: useBound(prefs, prefs.readProfileName),
    readContextLimit: useCallback(
      () => ephemeral.getEphemeralSetting('context-limit'),
      [ephemeral],
    ),
    getMaxSessionTurns: useBound(limits, limits.getMaxSessionTurns),
    readEmojiFilterMode: useCallback(
      () => resolveEmojiFilterMode(ephemeral),
      [ephemeral],
    ),
    projectTempDir,
    checkpointOperations: checkpoint.getCheckpointingEnabled()
      ? checkpoint.checkpoints
      : undefined,
    readTargetDir: useBound(session, session.getTargetDir),
    readUsePty: useBound(shell, shell.getShouldUseNodePtyShell),
    readShellExecutionConfig: useBound(shell, shell.getShellExecutionConfig),
    readPtyWidth: useBound(shell, shell.getPtyTerminalWidth),
    readPtyHeight: useBound(shell, shell.getPtyTerminalHeight),
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

function useTurnFlush(
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

function useBound<Owner, Args extends unknown[], Result>(
  owner: Owner,
  operation: (this: Owner, ...args: Args) => Result,
): (...args: Args) => Result {
  return useMemo(() => operation.bind(owner), [owner, operation]);
}
