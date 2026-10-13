/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ContentGenerator,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type { FromConfigOptions } from './config-types.js';
import type { Agent } from './agent.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type { HostGitHubBrokerOwner } from './host-github-broker-owner.js';
import { AgentBootstrapError } from './agentBootstrap.js';
import { createTaskRegistration } from './runtimeFactories.js';
import { initializeAdoptedClient } from './fromConfig-session.js';
import { finalizeAdoptedAgent } from './fromConfig-finalization.js';
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';
import {
  adoptedDefinitionCleanup,
  assembleAdoptedDefinitionOperations,
} from './adopted-definition-assembly.js';

export async function completeAdoptedAgent(
  options: FromConfigOptions,
  github: HostGitHubBrokerOwner | undefined,
  runtimeId: string,
  mcp: McpRuntimeOwner,
  media: SessionMediaOwner | undefined,
  settingsOwner: SessionSettingsOwner,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  files: ProviderFileLifecycle,
  tokenizerFactory: RuntimeTokenizerFactory,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  activate: () => Promise<void>,
  closeRuntime: () => Promise<void>,
  clientBus: MessageBus | undefined,
  ownsMcp: boolean,
): Promise<Agent> {
  let sessionClient: SessionClientOwner | undefined;
  try {
    sessionClient = await initializeAdoptedClient(
      options.config,
      options.settingsService,
      settingsOwner,
      manager,
      oauth,
      contentGeneratorFactory,
      tokenizerFactory,
      files,
      media,
      mcp.readInstructions,
      mcp.workspacePaths,
      options.activation,
      options.activationPreflight,
      options.runtimeFactoryBindings?.agentClientFactory,
      options.agentClient,
      clientBus,
      options.imageOperation,
    );
    await initializeAdoptedSession(
      sessionClient,
      mcp,
      options.config,
      options.definitionOwner,
      options.definitionOwnership,
      ownsMcp,
      options.hookOwner,
      options.runtimeFactoryBindings?.taskToolRegistration(
        createTaskRegistration(options.credentialAuthority),
      ) ?? createTaskRegistration(options.credentialAuthority),
      github,
      activate,
      options.prepareSessionTools,
    );
    return await finalizeAdoptionAssembly(
      options,
      runtimeId,
      mcp,
      media,
      settingsOwner,
      manager,
      oauth,
      tokenizerFactory,
      sessionClient,
      closeRuntime,
    );
  } catch (primaryError) {
    return retireFailedAdoption(
      primaryError,
      closeRuntime,
      mcp,
      media,
      sessionClient,
      options.definitionOwner,
      options.definitionOwnership,
      ownsMcp,
    );
  }
}
async function initializeAdoptedSession(
  client: SessionClientOwner,
  mcp: McpRuntimeOwner,
  config: Config,
  definitionOwner: FromConfigOptions['definitionOwner'],
  definitionOwnership: FromConfigOptions['definitionOwnership'],
  ownsMcp: boolean,
  hookOwner: FromConfigOptions['hookOwner'],
  registration: ReturnType<typeof createTaskRegistration>,
  github: HostGitHubBrokerOwner | undefined,
  activate: () => Promise<void>,
  prepareSessionTools: FromConfigOptions['prepareSessionTools'],
): Promise<void> {
  client.bindHostGitHub(github);
  const definitions = assembleAdoptedDefinitionOperations(
    mcp,
    definitionOwner,
    config,
    definitionOwnership,
    ownsMcp,
  );
  client.bindMcpRuntime(
    mcp,
    registration,
    definitions.profileDefinitions,
    definitions.subagentDefinitions,
  );
  if (client.hasHookComposition()) {
    if (hookOwner !== undefined)
      throw new AgentBootstrapError(
        'Preflight hook ownership cannot be replaced during adoption',
      );
  } else {
    client.bindHooks(hookOwner);
  }
  await activate();
  await mcp.initialize();
  await client.initializeTools();
  if (prepareSessionTools)
    client.toolCatalog.prepareTools((tools) =>
      prepareSessionTools(config, client.messageBus, tools),
    );
}

function ownsMcpRuntime(
  ownership: 'agent' | 'caller' | undefined,
  supplied: boolean,
): boolean {
  return (ownership ?? (supplied ? 'caller' : 'agent')) === 'agent';
}

function finalizeAdoptionAssembly(
  options: FromConfigOptions,
  runtimeId: string,
  mcp: McpRuntimeOwner,
  media: SessionMediaOwner | undefined,
  settingsOwner: SessionSettingsOwner,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  tokenizerFactory: RuntimeTokenizerFactory,
  sessionClient: SessionClientOwner,
  closeRuntime: () => Promise<void>,
): Promise<Agent> {
  return finalizeAdoptedAgent(
    options.providerManager,
    options.sessionId,
    tokenizerFactory,
    options.activation,
    options.activationPreflight,
    options.config,
    manager,
    oauth,
    options.settingsService,
    runtimeId,
    settingsOwner,
    () => 'agent',
    closeRuntime,
    options.onApproval,
    options.onOAuthPrompt,
    options.editorCallbacks,
    mcp,
    options.definitionOwner,
    options.definitionOwnership,
    ownsMcpRuntime(options.mcpOwnership, options.mcpRuntime !== undefined),
    options.toolSchedulerFactory,
    options.asyncTaskManager,
    options.sessionIdentityOwnership ?? 'facade',
    media,
    sessionClient,
  );
}

function retireFailedAdoption(
  primary: unknown,
  closeRuntime: () => Promise<void>,
  mcp: McpRuntimeOwner,
  media: SessionMediaOwner | undefined,
  client: SessionClientOwner | undefined,
  definitions: FromConfigOptions['definitionOwner'],
  ownership: FromConfigOptions['definitionOwnership'],
  ownsMcp: boolean,
): Promise<never> {
  return cleanupFailedAdoption(
    primary,
    closeRuntime,
    adoptedDefinitionCleanup(mcp, definitions, ownership, ownsMcp),
    media === undefined ? undefined : () => media.dispose(),
    client?.dispose.bind(client),
  );
}
