/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback } from 'react';
import type { AgentStreamInputs } from './hooks/agentStream/useAgentStream.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { useContentIdentityReader } from './hooks/agentStream/useStreamOwnerCallbacks.js';
import type { SlashCommandRuntime, UiRuntime } from './cliUiRuntime.js';
import { resolveEmojiFilterMode } from './utils/iContentToHistoryItems.js';
import {
  useBound,
  useTurnFlush,
  useCancelRunningSubagents,
} from './hooks/agentStream/useStreamOwnerCallbacks.js';
export function useInputAgentOperations(
  readHistory: Agent['getHistory'],
  stream: Agent['stream'],
  appendHistory: Agent['addHistory'],
  injectSteer: Agent['injectSteer'],
  getProviderContextLimit: Agent['getProviderContextLimit'],
  getContentPrefixIdentity: ReturnType<typeof useContentIdentityReader>,
  tools: Pick<
    Agent['tools'],
    | 'setDisplayCallbacks'
    | 'setEditorCallbacks'
    | 'openClientChannel'
    | 'subscribeChildTools'
    | 'get'
  >,
  mcp: Pick<Agent['mcp'], 'findResource' | 'readResource'>,
  metrics: Pick<Agent['metrics'], 'setLastPromptTokenCount'>,
  tasks: Pick<
    Agent['tasks'],
    'listRunning' | 'cancel' | 'subscribeNotifications'
  >,
  session: Pick<Agent['session'], 'flushRecording'>,
  recordingOwner: 'agent' | 'raw' | undefined,
  recorder: RecordingIntegration | undefined,
): Pick<
  AgentStreamInputs,
  | 'readHistory'
  | 'stream'
  | 'setDisplayCallbacks'
  | 'setEditorCallbacks'
  | 'openClientChannel'
  | 'subscribeChildTools'
  | 'appendShellHistory'
  | 'injectSteer'
  | 'cancelRunningAsyncTasks'
  | 'getProviderContextLimit'
  | 'getContentPrefixIdentity'
  | 'getToolHandle'
  | 'findResource'
  | 'readResource'
  | 'setLastPromptTokenCount'
  | 'subscribeTaskNotifications'
  | 'flushRecording'
> {
  return {
    readHistory,
    stream,
    setDisplayCallbacks: useBound(tools, tools.setDisplayCallbacks),
    setEditorCallbacks: useBound(tools, tools.setEditorCallbacks),
    openClientChannel: useBound(tools, tools.openClientChannel),
    subscribeChildTools: useBound(tools, tools.subscribeChildTools),
    appendShellHistory: appendHistory,
    injectSteer,
    cancelRunningAsyncTasks: useCancelRunningSubagents(tasks),
    getProviderContextLimit,
    getContentPrefixIdentity,
    getToolHandle: useBound(tools, tools.get),
    findResource: useBound(mcp, mcp.findResource),
    readResource: useBound(mcp, mcp.readResource),
    setLastPromptTokenCount: useBound(metrics, metrics.setLastPromptTokenCount),
    subscribeTaskNotifications: useBound(tasks, tasks.subscribeNotifications),
    flushRecording: useTurnFlush(session, recordingOwner, recorder),
  };
}
export function useInputStreamPolicy(
  session: UiRuntime['session'],
  events: UiRuntime['events'],
  model: UiRuntime['model'],
  ephemeral: UiRuntime['ephemeral'],
  shell: UiRuntime['shell'],
  checkpoint: UiRuntime['checkpoint'],
  files: UiRuntime['files'],
  prefs: UiRuntime['settings'],
  buckets: UiRuntime['bucketFailover'],
  limits: UiRuntime['sessionLimits'],
  projectTempDir: string,
  projectCheckpointsDir: string,
) {
  return {
    isCheckpointingEnabled: useBound(
      checkpoint,
      checkpoint.getCheckpointingEnabled,
    ),
    projectCheckpointsDir,
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
  };
}

export function useInputReadOperations(
  hooks: UiRuntime['hooks'],
  app: UiRuntime['app'],
  isAgentClientPresent: () => boolean,
  readIdeMode: () => boolean,
  shell: UiRuntime['shell'],
  mcp: UiRuntime['mcp'],
  refreshMemory: SlashCommandRuntime['refreshMemory'],
  readDebugMode: () => boolean,
) {
  return {
    refreshMemory,
    readDebugMode,
    endInputHookSession: useBound(hooks, hooks.endHookSession),
    readInitialPrompt: useBound(app, app.getQuestion),
    isAgentClientPresent,
    readIdeMode,
    readInteractiveShellEnabled: useBound(
      shell,
      shell.getEnableInteractiveShell,
    ),
    readMcpServers: useBound(mcp, mcp.getMcpServers),
  };
}
