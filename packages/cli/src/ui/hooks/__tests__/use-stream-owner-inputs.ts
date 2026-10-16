/**
 * @license
 * Copyright 2026 Vybestack LLC
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
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { StreamRuntime, UiSubagentManager } from '../../cliUiRuntime.js';
import { resolveEmojiFilterMode } from '../../utils/iContentToHistoryItems.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from '../../utils/modelIdentity.js';
import {
  useAgentStream,
  type StreamInteractionInputs,
} from '../agentStream/useAgentStream.js';

export const useTestAgentStream = (
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
  return useAgentStream({
    ...input,
    readHistory: useBound(agent, agent.getHistory),
    isCheckpointingEnabled: useBound(
      checkpoint,
      checkpoint.getCheckpointingEnabled,
    ),
    projectCheckpointsDir: runtime.projectCheckpointsDir,
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
  });
};

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
