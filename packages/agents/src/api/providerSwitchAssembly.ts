/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assembleSessionImages } from './session-image-assembly.js';
import { assembleModelSelection } from './model-selection.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';
import { assembleWorkspaceMemory } from '@vybestack/llxprt-code-core';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { SessionClientOwner } from '../session/session-client-owner.js';
import { buildAgentClientFactory } from './agentBootstrap.js';

import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { switchActiveProvider } from '@vybestack/llxprt-code-providers/runtime/providerSwitch.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';

import {
  AgentActivationBootstrap,
  type AgentActivationOperation,
} from './activationPreflightState.js';
import { checkpointProviderTransition } from './providerTransitionCheckpoint.js';
import { executeProviderActivation } from './providerActivationExecutor.js';

export function assembleProviderSwitch(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  readKind: () => RuntimeKind | undefined,
  initializeClient: () => Promise<void>,
  settingsOwner: SessionSettingsOwner,
): ProviderSwitcher {
  return async (name, options = {}) => {
    const restore = checkpointProviderTransition(
      settingsOwner,
      settings,
      manager,
      oauth?.checkpointRetryHandlers() ?? (() => {}),
    );
    const publish = options.publication !== 'deferred';
    const publication = publish
      ? settingsOwner.beginModelPublication()
      : undefined;
    let result;
    try {
      result = await switchActiveProvider(
        name,
        { ...options, publication: 'deferred' },
        config,
        settings,
        manager,
        oauth,
        readKind(),
        initializeClient,
        settingsOwner,
      );
    } catch (error) {
      try {
        restore();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Provider switch rollback failed',
        );
      } finally {
        publication?.rollback();
      }
      throw error;
    }
    publication?.commit();
    if (publish && result.changed) {
      const model = settingsOwner.readSelectedModel() ?? result.nextProvider;
      const profileName = settings.getCurrentProfileName();
      settingsOwner.publishModelProfile({
        model,
        providerName: result.nextProvider,
        profileName,
        displayLabel: profileName ?? model,
      });
    }
    return result;
  };
}

function assembleActivationExecutor(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  switchProvider: ProviderSwitcher,
  owner: SessionSettingsOwner,
  refreshClient: (method?: string) => Promise<void>,
): (
  intent: Parameters<typeof executeProviderActivation>[1],
) => ReturnType<typeof executeProviderActivation> {
  const selection = assembleModelSelection(owner);
  return async (intent) => {
    await owner.startTelemetry(config);
    return executeProviderActivation(
      config,
      intent,
      switchProvider,
      settings,
      manager,
      refreshClient,
      selection,
    );
  };
}

function createPreflightMedia(
  config: Config,
  client: AgentClientContract | undefined,
): SessionMediaOwner | undefined {
  return client === undefined
    ? new SessionMediaOwner(
        config.projectTempDir,
        config.getMediaStoreQuotaByteLimit(),
      )
    : undefined;
}

function requirePreflightMedia(
  client: AgentClientContract | undefined,
  media: SessionMediaOwner | undefined,
): NonNullable<AgentClientContract['mediaStore']> {
  const store = client?.mediaStore ?? media?.store;
  if (store === undefined)
    throw new Error('Preflight requires an explicit session media store');
  return store;
}

function composeActivationWorkspace(
  config: Config,
  mcpRuntime: McpRuntimeOwner | undefined,
  filesystemOwner: WorkspaceFilesystemOwner | undefined,
  memoryOwner: WorkspaceMemoryOwner | undefined,
  trust: WorkspaceTrustControlPort,
): {
  workspaceFilesystem: WorkspaceFilesystemOwner;
  workspaceMemory: WorkspaceMemoryOwner;
  workspaceDefinitions: WorkspaceDefinitionOwner;
} {
  const workspaceFilesystem =
    mcpRuntime?.workspaceFilesystem ??
    filesystemOwner ??
    new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      customExcludes: config.customExcludes,
      includeDirectories: config.getConfiguredIncludeDirectories(),
      isTrusted: () => trust.isTrustedFolder(),
    });
  const workspaceMemory =
    mcpRuntime?.workspaceMemory ??
    memoryOwner ??
    assembleWorkspaceMemory(config, workspaceFilesystem, trust);
  const workspaceDefinitions =
    mcpRuntime?.workspaceDefinitions ??
    new WorkspaceDefinitionOwner(
      config.profileDirectory ?? join(config.globalConfigRoot, 'profiles'),
      config.subagentDirectory ?? join(config.globalConfigRoot, 'subagents'),
    );
  return { workspaceFilesystem, workspaceMemory, workspaceDefinitions };
}

function resolveActivationSettings(
  settings: SettingsService,
  supplied: SessionSettingsOwner | undefined,
): SessionSettingsOwner {
  const owner = supplied ?? new SessionSettingsOwner(settings);
  owner.assertSettingsIdentity(settings);
  return owner;
}

export async function assembleAgentActivationBootstrap(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  readKind: () => RuntimeKind | undefined,
  agentClient?: AgentClientContract,
  mcpRuntime?: McpRuntimeOwner,
  filesystemOwner?: WorkspaceFilesystemOwner,
  memoryOwner?: WorkspaceMemoryOwner,
  suppliedSettingsOwner?: SessionSettingsOwner,
  settingsOwnerOwnership = defaultSettingsOwnership(suppliedSettingsOwner),
  suppliedTrust?: WorkspaceTrustControlPort,
  trustCleanup?: () => Promise<void>,
  tokenizerFactory?: SessionClientOwner['tokenizerFactory'],
  contentGeneratorFactory?: SessionClientOwner['contentGeneratorFactory'],
  providerFileLifecycle?: ProviderFileLifecycle,
  messageBus?: ConstructorParameters<typeof SessionClientOwner>[11],
  memoryOwnership: 'borrowed' | 'transferred' = 'borrowed',
): Promise<AgentActivationOperation> {
  const workspace = prepareActivationInputs(
    config,
    manager,
    agentClient,
    mcpRuntime,
    filesystemOwner,
    memoryOwner,
    suppliedTrust,
    settings,
    suppliedSettingsOwner,
  );
  const factories = configureProviderRuntimeFactories(config, manager, {
    tokenizerFactory,
    contentGeneratorFactory,
  });
  const sessionClient = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    buildAgentClientFactory(),
    workspace.store,
    mcpRuntime?.readInstructions ?? (() => undefined),
    workspace.workspaceFilesystem.paths,
    workspace.settingsOwner,
    factories.contentGeneratorFactory,
    factories.tokenizerFactory,
    agentClient,
    messageBus,
  );
  const execute = await bindActivationClient(
    sessionClient,
    config,
    manager,
    oauth,
    settings,
    workspace,
    mcpRuntime,
    providerFileLifecycle,
    readKind,
  );
  return new AgentActivationBootstrap(
    config,
    manager,
    execute,
    workspace.mediaOwner,
    sessionClient,
    workspace.workspaceFilesystem,
    workspace.workspaceMemory,
    mcpRuntime === undefined,
    workspace.settingsOwner,
    settingsOwnerOwnership,
    workspace.workspaceDefinitions,
    mcpRuntime === undefined,
    workspace.workspaceTrust,
    resolveTrustCleanup(workspace.ownedTrust, trustCleanup),
    oauth ?? undefined,
    messageBus ?? mcpRuntime?.messageBus,
    resolveActivationMemoryOwnership(mcpRuntime, memoryOwner, memoryOwnership),
  );
}

function resolveTrustCleanup(
  owned: WorkspaceTrustLifecycle | undefined,
  cleanup: (() => Promise<void>) | undefined,
): (() => Promise<void>) | undefined {
  return owned === undefined ? cleanup : () => owned.dispose();
}

async function bindActivationClient(
  sessionClient: SessionClientOwner,
  config: Config,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  settings: SettingsService,
  workspace: ReturnType<typeof prepareActivationInputs>,
  mcpRuntime: McpRuntimeOwner | undefined,
  providerFileLifecycle: ProviderFileLifecycle | undefined,
  readKind: () => RuntimeKind | undefined,
): Promise<ReturnType<typeof assembleActivationExecutor>> {
  try {
    assembleSessionImages(
      {
        hasImageComposition: () => sessionClient.hasImageComposition(),
        bindImageOperation: (run, dispose) =>
          sessionClient.bindImageOperation(run, dispose),
      },
      config.getTargetDir(),
      manager,
      oauth ?? undefined,
      settings,
    );
    bindActivationCapabilities(
      sessionClient,
      providerFileLifecycle,
      oauth,
      workspace.workspaceDefinitions,
      workspace.workspaceMemory,
      mcpRuntime,
    );
    return createPreflightExecutor(
      config,
      settings,
      manager,
      oauth,
      readKind,
      workspace.settingsOwner,
      (method) => sessionClient.refreshAuth(method),
    );
  } catch (error) {
    try {
      await sessionClient.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Activation client binding cleanup failed',
      );
    }
    throw error;
  }
}

function prepareActivationInputs(
  config: Config,
  manager: RuntimeProviderManager,
  agentClient: AgentClientContract | undefined,
  mcpRuntime: McpRuntimeOwner | undefined,
  filesystemOwner: WorkspaceFilesystemOwner | undefined,
  memoryOwner: WorkspaceMemoryOwner | undefined,
  suppliedTrust: WorkspaceTrustControlPort | undefined,
  settings: SettingsService,
  suppliedSettingsOwner: SessionSettingsOwner | undefined,
) {
  agentClient?.assertConfig(config);
  agentClient?.assertProviderManager(manager);
  const { ownedTrust, workspaceTrust } = resolveActivationTrust(
    config,
    mcpRuntime,
    suppliedTrust,
  );
  const settingsOwner = resolveActivationSettings(
    settings,
    suppliedSettingsOwner,
  );
  settingsOwner.bindTelemetry(config);
  const mediaOwner = createPreflightMedia(config, agentClient);
  const store = requirePreflightMedia(agentClient, mediaOwner);
  const { workspaceFilesystem, workspaceMemory, workspaceDefinitions } =
    composeActivationWorkspace(
      config,
      mcpRuntime,
      filesystemOwner,
      memoryOwner,
      workspaceTrust,
    );

  return {
    ownedTrust,
    workspaceTrust,
    settingsOwner,
    mediaOwner,
    store,
    workspaceFilesystem,
    workspaceMemory,
    workspaceDefinitions,
  };
}

// Memory disposition is tracked independently of filesystem ownership: memory
// the preflight assembled itself is its to transfer, memory supplied by the
// caller stays borrowed unless the caller explicitly transfers it, and memory
// reached through an MCP handoff belongs to that handoff.
function resolveActivationMemoryOwnership(
  mcpRuntime: McpRuntimeOwner | undefined,
  suppliedMemory: WorkspaceMemoryOwner | undefined,
  requested: 'borrowed' | 'transferred',
): 'borrowed' | 'transferred' {
  if (mcpRuntime !== undefined) return 'borrowed';
  return suppliedMemory === undefined ? 'transferred' : requested;
}

export function assembleSessionProviderSwitch(
  handle: IsolatedRuntimeContextHandle,
  refreshAuth: () => Promise<void>,
): ProviderSwitcher {
  return assembleProviderSwitch(
    handle.config,
    handle.settingsService,
    handle.providerManager,
    handle.oauthManager,
    () => handle.readRuntimeKind(),
    refreshAuth,
    handle.settingsOwner,
  );
}

function bindActivationCapabilities(
  sessionClient: Pick<
    SessionClientOwner,
    | 'bindProviderFiles'
    | 'bindMcpRuntime'
    | 'bindHooks'
    | 'bindDefinitionReads'
    | 'bindWorkspaceInstructions'
  >,
  providerFileLifecycle: ProviderFileLifecycle | undefined,
  oauth: OAuthManager | null,
  workspaceDefinitions: WorkspaceDefinitionOwner,
  workspaceMemory: WorkspaceMemoryOwner,
  mcpRuntime: McpRuntimeOwner | undefined,
): void {
  const files =
    providerFileLifecycle ??
    new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 512 * 1024 * 1024 });
  sessionClient.bindProviderFiles(
    files,
    (provider) => oauth?.composeRetryOperations(provider) ?? {},
    (scope) => SessionClientOwner.cleanupProviderScope(files, scope),
  );
  if (mcpRuntime !== undefined) {
    sessionClient.bindMcpRuntime(mcpRuntime);
    sessionClient.bindHooks();
  } else {
    sessionClient.bindDefinitionReads(
      workspaceDefinitions.profileReads,
      workspaceDefinitions.subagentReads,
    );
    sessionClient.bindWorkspaceInstructions(workspaceMemory);
  }
}

function resolveActivationTrust(
  config: Config,
  mcpRuntime: McpRuntimeOwner | undefined,
  suppliedTrust: WorkspaceTrustControlPort | undefined,
) {
  mcpRuntime?.assertConfig(config, mcpRuntime.messageBus);
  const ownedTrust =
    mcpRuntime === undefined && suppliedTrust === undefined
      ? new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        })
      : undefined;
  const workspaceTrust = mcpRuntime?.trust ?? suppliedTrust ?? ownedTrust;
  if (workspaceTrust === undefined)
    throw new Error('Preflight requires an explicit trust authority');
  return { ownedTrust, workspaceTrust };
}

function createPreflightExecutor(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  readKind: () => RuntimeKind | undefined,
  settingsOwner: SessionSettingsOwner,
  refreshAuth: (method?: string) => Promise<void>,
): ReturnType<typeof assembleActivationExecutor> {
  const switchProvider = assembleProviderSwitch(
    config,
    settings,
    manager,
    oauth,
    readKind,
    () => refreshAuth(),
    settingsOwner,
  );
  return assembleActivationExecutor(
    config,
    settings,
    manager,
    switchProvider,
    settingsOwner,
    refreshAuth,
  );
}

function defaultSettingsOwnership(
  owner: SessionSettingsOwner | undefined,
): 'borrowed' | 'transferred' {
  return owner === undefined ? 'transferred' : 'borrowed';
}
