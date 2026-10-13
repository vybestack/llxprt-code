/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { finalizeAgent } from './createAgent.js';
import type {
  Config,
  RuntimeProviderManager,
  SessionSettingsOwner,
} from '@vybestack/llxprt-code-core';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  AgentConfig,
  EditorCallbacks,
  AgentSchedulerHandle,
} from './config-types.js';
import type { SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type { Agent } from './agent.js';

export function bindCreatedAgentFinalization(
  resolvedAuth: Parameters<typeof finalizeAgent>[1],
  config: Config,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  settings: SettingsService,
  runtimeId: string,
  settingsOwner: SessionSettingsOwner,
  readRuntimeKind: () => RuntimeKind,
  closeRuntime: () => void | Promise<void>,
  onApproval: AgentConfig['onApproval'],
  onOAuthPrompt: AgentConfig['onOAuthPrompt'],
  editorCallbacks: EditorCallbacks | undefined,
  injectedSchedulerHandles: AgentSchedulerHandle[],
  schedulerFactory: SchedulerConstruction,
  mediaOwner: SessionMediaOwner,
): (
  activated: Parameters<typeof finalizeAgent>[0],
  mcpRuntime: McpRuntimeOwner,
  ownedSessionClient: SessionClientOwner,
) => Promise<Agent> {
  return (activated, mcpRuntime, ownedSessionClient) =>
    finalizeAgent(
      activated,
      resolvedAuth,
      config,
      providerManager,
      oauthManager,
      settings,
      runtimeId,
      settingsOwner,
      readRuntimeKind,
      closeRuntime,
      onApproval,
      onOAuthPrompt,
      editorCallbacks,
      injectedSchedulerHandles,
      'agent',
      () => mcpRuntime.dispose(),
      mcpRuntime,
      schedulerFactory,
      undefined,
      'config',
      mediaOwner,
      ownedSessionClient,
      mcpRuntime.workspaceSkills.operations,
    );
}
