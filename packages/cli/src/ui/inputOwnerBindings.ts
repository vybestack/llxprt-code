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
import type {
  AppEventRuntime,
  AppStateRuntime,
  BucketFailoverRuntime,
  CheckpointRuntime,
  EphemeralSettingsRuntime,
  HookSkillState,
  McpState,
  MemoryState,
  ModelState,
  SessionIdentity,
  SessionLimitsRuntime,
  SettingsTelemetryState,
  ShellState,
} from './cliUiRuntime.js';
import type { AtCommandHelperRuntime } from './hooks/atCommandProcessorHelpers.js';
import { resolveEmojiFilterMode } from './utils/iContentToHistoryItems.js';
import {
  useBound,
  useTurnFlush,
  useCancelRunningSubagents,
} from './hooks/agentStream/useStreamOwnerCallbacks.js';
/** The exact agent operations the stream input path binds. */
export interface InputAgentOperations {
  readonly readHistory: Agent['streamHistory'];
  readonly stream: Agent['stream'];
  readonly appendHistory: Agent['addHistory'];
  readonly injectSteer: Agent['injectSteer'];
  readonly getProviderContextLimit: Agent['getProviderContextLimit'];
  readonly getContentPrefixIdentity: ReturnType<
    typeof useContentIdentityReader
  >;
  readonly tools: Pick<
    Agent['tools'],
    | 'setDisplayCallbacks'
    | 'setEditorCallbacks'
    | 'openClientChannel'
    | 'subscribeChildTools'
    | 'get'
  >;
  readonly mcp: Pick<Agent['mcp'], 'findResource' | 'readResource'>;
  readonly metrics: Pick<Agent['metrics'], 'setLastPromptTokenCount'>;
  readonly tasks: Pick<
    Agent['tasks'],
    'listRunning' | 'cancel' | 'subscribeNotifications'
  >;
  readonly session: Pick<Agent['session'], 'flushRecording'>;
  readonly recordingOwner: 'agent' | 'raw' | undefined;
  readonly recorder: RecordingIntegration | undefined;
}

export function useInputAgentOperations(
  ops: InputAgentOperations,
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
  const {
    readHistory,
    stream,
    appendHistory,
    injectSteer,
    getProviderContextLimit,
    getContentPrefixIdentity,
    tools,
    mcp,
    metrics,
    tasks,
    session,
    recordingOwner,
    recorder,
  } = ops;
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
/** Shell reads the stream policy and input path make. */
export type InputShellReads = Pick<
  ShellState,
  | 'getShouldUseNodePtyShell'
  | 'getShellExecutionConfig'
  | 'getPtyTerminalWidth'
  | 'getPtyTerminalHeight'
  | 'getEnableInteractiveShell'
>;

/**
 * The capabilities the stream-policy bindings read, each narrowed to the
 * operations the bound callbacks actually call.
 */
export interface StreamPolicyReads {
  readonly session: Pick<SessionIdentity, 'getSessionId' | 'getTargetDir'>;
  readonly events: AppEventRuntime;
  readonly model: ModelState;
  readonly ephemeral: EphemeralSettingsRuntime;
  readonly shell: InputShellReads;
  readonly checkpoint: CheckpointRuntime;
  readonly files: AtCommandHelperRuntime;
  readonly settings: Pick<
    SettingsTelemetryState,
    | 'logUserPrompt'
    | 'readSelectedProvider'
    | 'readCitations'
    | 'readProfileName'
  >;
  readonly bucketFailover: BucketFailoverRuntime;
  readonly sessionLimits: SessionLimitsRuntime;
  readonly projectTempDir: string;
  readonly projectCheckpointsDir: string;
}

export function useInputStreamPolicy(reads: StreamPolicyReads) {
  const {
    session,
    events,
    model,
    ephemeral,
    shell,
    checkpoint,
    files,
    settings: prefs,
    bucketFailover: buckets,
    sessionLimits: limits,
    projectTempDir,
    projectCheckpointsDir,
  } = reads;
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

/** The remaining runtime reads `useAppInput` takes. */
export interface InputReadOperations {
  readonly hooks: Pick<HookSkillState, 'endHookSession'>;
  readonly app: Pick<AppStateRuntime, 'getQuestion'>;
  readonly isAgentClientPresent: () => boolean;
  readonly readIdeMode: () => boolean;
  readonly shell: Pick<ShellState, 'getEnableInteractiveShell'>;
  readonly mcp: Pick<McpState, 'getMcpServers'>;
  readonly refreshMemory: MemoryState['refreshMemory'];
  readonly readDebugMode: () => boolean;
}

export function useInputReadOperations(reads: InputReadOperations) {
  const {
    hooks,
    app,
    isAgentClientPresent,
    readIdeMode,
    shell,
    mcp,
    refreshMemory,
    readDebugMode,
  } = reads;
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
