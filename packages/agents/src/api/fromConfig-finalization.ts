/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
  WorkspaceDefinitionOwner,
} from '@vybestack/llxprt-code-core';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type {
  AgentSchedulerHandle,
  AgentSchedulerFactory,
  ApprovalHandler,
  OAuthPromptHandler,
  EditorCallbacks,
  ProviderActivationIntent,
} from './config-types.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type { ActivationPreflight } from './activationPreflightState.js';
import { activateAdoptedSession } from './fromConfig-session.js';
import {
  adoptedDefinitionCleanup,
  assembleAdoptedDefinitionOperations,
} from './adopted-definition-assembly.js';
import type { Agent } from './agent.js';
import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { finalizeAgent, resolveSchedulerFactory } from './createAgent.js';

export async function prepareAdoptedConfig(
  config: Config,
  manager: RuntimeProviderManager | undefined,
  sessionId: string | undefined,
  settingsOwner: SessionSettingsOwner,
  tokenizerFactory: RuntimeTokenizerFactory,
): Promise<{ provider: string; model: string; sessionId?: string }> {
  const activeRuntimeProvider =
    manager?.getActiveProviderName() ?? config.getProvider();
  const parsed = {
    provider: activeRuntimeProvider ?? '',
    model: settingsOwner.readSelectedModel() ?? config.getModel(),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
  await tokenizerFactory.prepareTokenizer?.(parsed.provider, parsed.model);
  return parsed;
}

export async function finalizeAdoptedAgent(
  selectedManager: RuntimeProviderManager | undefined,
  sessionId: string | undefined,
  tokenizerFactory: RuntimeTokenizerFactory,
  activation: ProviderActivationIntent | undefined,
  activationPreflight: ActivationPreflight | undefined,
  config: Config,
  manager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  settingsService: SettingsService,
  runtimeId: string,
  settingsOwner: SessionSettingsOwner,
  readRuntimeKind: () => RuntimeKind,
  closeRuntime: () => void | Promise<void>,
  onApproval: ApprovalHandler | undefined,
  onOAuthPrompt: OAuthPromptHandler | undefined,
  editorCallbacks: EditorCallbacks | undefined,
  mcp: McpRuntimeOwner,
  definitions: WorkspaceDefinitionOwner | undefined,
  definitionOwnership: 'agent' | 'caller' | undefined,
  ownsMcp: boolean,
  toolSchedulerFactory: AgentSchedulerFactory | undefined,
  asyncTaskManager: AsyncTaskManager | undefined,
  sessionIdentityOwnership: 'config' | 'facade',
  mediaOwner: SessionMediaOwner | undefined,
  sessionClient: SessionClientOwner,
): Promise<Agent> {
  await activateAdoptedSession(
    config,
    settingsService,
    settingsOwner,
    manager,
    oauthManager,
    readRuntimeKind,
    sessionClient,
    activation,
    activationPreflight,
  );
  const parsed = await prepareAdoptedConfig(
    config,
    selectedManager,
    sessionId,
    settingsOwner,
    tokenizerFactory,
  );
  const { injectedSchedulerHandles, schedulerFactory } =
    assembleAdoptedScheduler(toolSchedulerFactory);
  return finalizeAgent(
    parsed,
    { baseUrl: admittedEndpoint(settingsService, parsed.provider) },
    config,
    manager,
    oauthManager,
    settingsService,
    runtimeId,
    settingsOwner,
    readRuntimeKind,
    closeRuntime,
    onApproval,
    onOAuthPrompt,
    editorCallbacks,
    injectedSchedulerHandles,
    'caller',
    adoptedDefinitionCleanup(mcp, definitions, definitionOwnership, ownsMcp),
    assembleAdoptedDefinitionOperations(
      mcp,
      definitions,
      config,
      definitionOwnership,
      ownsMcp,
    ),
    schedulerFactory,
    asyncTaskManager,
    sessionIdentityOwnership,
    mediaOwner,
    sessionClient,
    mcp.workspaceSkills.operations,
  );
}

function assembleAdoptedScheduler(
  toolSchedulerFactory: AgentSchedulerFactory | undefined,
): {
  injectedSchedulerHandles: AgentSchedulerHandle[];
  schedulerFactory: ReturnType<typeof resolveSchedulerFactory>;
} {
  const injectedSchedulerHandles: AgentSchedulerHandle[] = [];
  return {
    injectedSchedulerHandles,
    schedulerFactory: resolveSchedulerFactory(
      false,
      toolSchedulerFactory,
      injectedSchedulerHandles,
    ),
  };
}
