import { cleanupProviderScope } from '../session/session-client-cleanup.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { assembleSessionImages } from './session-image-assembly.js';
import { assembleModelSelection } from './model-selection.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';
import { assembleWorkspaceMemory } from '@vybestack/llxprt-code-core';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

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
import { switchActiveProvider } from './provider-switch/provider-switch.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';

import { AgentActivationBootstrap } from './activationPreflightState.js';
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

function acquireActivationFilesystem(
  config: Config,
  mcp: McpRuntimeOwner | undefined,
  supplied: WorkspaceFilesystemOwner | undefined,
  trust: WorkspaceTrustControlPort,
  release: AcquisitionRelease,
): WorkspaceFilesystemOwner {
  const filesystem =
    mcp?.workspaceFilesystem ??
    supplied ??
    new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      customExcludes: config.customExcludes,
      includeDirectories: config.getConfiguredIncludeDirectories(),
      isTrusted: () => trust.isTrustedFolder(),
    });
  if (mcp === undefined)
    release.acquire('settings', () => filesystem.dispose());
  return filesystem;
}

function acquireActivationMemory(
  config: Config,
  mcp: McpRuntimeOwner | undefined,
  supplied: WorkspaceMemoryOwner | undefined,
  filesystem: WorkspaceFilesystemOwner,
  trust: WorkspaceTrustControlPort,
  ownership: 'borrowed' | 'transferred',
  release: AcquisitionRelease,
): WorkspaceMemoryOwner {
  const memory =
    mcp?.workspaceMemory ??
    supplied ??
    assembleWorkspaceMemory(config, filesystem, trust);
  if (ownership === 'transferred')
    release.acquire('settings', () => memory.dispose());
  return memory;
}

function acquireActivationDefinitions(
  config: Config,
  mcp: McpRuntimeOwner | undefined,
  release: AcquisitionRelease,
): WorkspaceDefinitionOwner {
  const definitions =
    mcp?.workspaceDefinitions ??
    new WorkspaceDefinitionOwner(
      config.profileDirectory ?? join(config.globalConfigRoot, 'profiles'),
      config.subagentDirectory ?? join(config.globalConfigRoot, 'subagents'),
    );
  if (mcp === undefined)
    release.acquire('settings', () => definitions.dispose());
  return definitions;
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
  providerLifetime: 'borrowed' | (() => Promise<void>),
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
): Promise<AgentActivationBootstrap> {
  const release = new AcquisitionRelease();
  try {
    return await prepareActivationOwner(
      config,
      settings,
      manager,
      agentClient,
      mcpRuntime,
      filesystemOwner,
      memoryOwner,
      suppliedSettingsOwner,
      settingsOwnerOwnership,
      suppliedTrust,
      trustCleanup,
      memoryOwnership,
      release,
      oauth,
      readKind,
      providerLifetime,
      tokenizerFactory,
      contentGeneratorFactory,
      providerFileLifecycle,
      messageBus,
    );
  } catch (error) {
    try {
      await release.rollback();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Activation acquisition cleanup failed',
      );
    }
    throw error;
  }
}

async function completeActivationAcquisition(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  readKind: () => RuntimeKind | undefined,
  providerLifetime: 'borrowed' | (() => Promise<void>),
  supplied: AgentClientContract | undefined,
  mcp: McpRuntimeOwner | undefined,
  store: ConstructorParameters<typeof SessionClientOwner>[4],
  owner: SessionSettingsOwner,
  media: SessionMediaOwner | undefined,
  filesystem: WorkspaceFilesystemOwner,
  memory: WorkspaceMemoryOwner,
  definitions: WorkspaceDefinitionOwner,
  trust: WorkspaceTrustControlPort,
  cleanupTrust: (() => Promise<void>) | undefined,
  settingsOwnership: 'borrowed' | 'transferred',
  content: SessionClientOwner['contentGeneratorFactory'] | undefined,
  tokenizer: SessionClientOwner['tokenizerFactory'] | undefined,
  files: ProviderFileLifecycle | undefined,
  bus: ConstructorParameters<typeof SessionClientOwner>[11],
  memoryOwnership: 'borrowed' | 'transferred',
  release: AcquisitionRelease,
): Promise<AgentActivationBootstrap> {
  const factoriesTokenizer = configureProviderTokenizer(manager, tokenizer);
  const factoriesContent = content ?? createRuntimeContentGeneratorFactory();
  const client = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    buildAgentClientFactory(),
    store,
    mcp?.readInstructions ?? (() => undefined),
    filesystem.paths,
    owner,
    factoriesContent,
    factoriesTokenizer,
    supplied,
    bus,
  );
  release.acquire('manager', () => client.dispose());
  const selectedFiles = acquireActivationFiles(files, config.getProxy());
  const execute = bindActivationClient(
    client,
    config,
    manager,
    oauth,
    settings,
    definitions,
    memory,
    owner,
    mcp,
    selectedFiles,
    readKind,
  );
  if (providerLifetime !== 'borrowed')
    client.adoptProviderLifetime(providerLifetime);
  return new AgentActivationBootstrap(
    config,
    manager,
    execute,
    selectedFiles,
    media,
    client,
    filesystem,
    memory,
    mcp === undefined,
    owner,
    settingsOwnership,
    definitions,
    mcp === undefined,
    trust,
    cleanupTrust,
    oauth ?? undefined,
    bus ?? mcp?.messageBus,
    memoryOwnership,
  );
}

function resolveTrustCleanup(
  owned: WorkspaceTrustLifecycle | undefined,
  cleanup: (() => Promise<void>) | undefined,
): (() => Promise<void>) | undefined {
  return owned === undefined ? cleanup : () => owned.dispose();
}

function bindActivationClient(
  sessionClient: Pick<
    SessionClientOwner,
    | 'hasImageComposition'
    | 'bindImageOperation'
    | 'bindProviderFiles'
    | 'bindMcpRuntime'
    | 'bindHooks'
    | 'bindDefinitionReads'
    | 'bindWorkspaceInstructions'
    | 'refreshAuth'
  >,
  config: Config,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  settings: SettingsService,
  definitions: WorkspaceDefinitionOwner,
  memory: WorkspaceMemoryOwner,
  owner: SessionSettingsOwner,
  mcpRuntime: McpRuntimeOwner | undefined,
  providerFileLifecycle: ProviderFileLifecycle,
  readKind: () => RuntimeKind | undefined,
): ReturnType<typeof assembleActivationExecutor> {
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
    definitions,
    memory,
    mcpRuntime,
  );
  return createPreflightExecutor(
    config,
    settings,
    manager,
    oauth,
    readKind,
    owner,
    (method) => sessionClient.refreshAuth(method),
  );
}

function acquireActivationSettings(
  config: Config,
  settings: SettingsService,
  supplied: SessionSettingsOwner | undefined,
  ownership: 'borrowed' | 'transferred',
  release: AcquisitionRelease,
): SessionSettingsOwner {
  const owner = resolveActivationSettings(settings, supplied);
  if (ownership === 'transferred')
    release.acquire('settings', () => owner.dispose());
  owner.bindTelemetry(config);
  return owner;
}

function acquireActivationMedia(
  config: Config,
  client: AgentClientContract | undefined,
  release: AcquisitionRelease,
): SessionMediaOwner | undefined {
  const media = createPreflightMedia(config, client);
  if (media !== undefined) release.acquire('settings', () => media.dispose());
  return media;
}

async function prepareActivationOwner(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  client: AgentClientContract | undefined,
  mcp: McpRuntimeOwner | undefined,
  suppliedFilesystem: WorkspaceFilesystemOwner | undefined,
  suppliedMemory: WorkspaceMemoryOwner | undefined,
  suppliedSettings: SessionSettingsOwner | undefined,
  settingsOwnership: 'borrowed' | 'transferred',
  suppliedTrust: WorkspaceTrustControlPort | undefined,
  trustCleanup: (() => Promise<void>) | undefined,
  memoryOwnership: 'borrowed' | 'transferred',
  release: AcquisitionRelease,
  oauth: OAuthManager | null,
  readKind: () => RuntimeKind | undefined,
  providerLifetime: 'borrowed' | (() => Promise<void>),
  tokenizer: SessionClientOwner['tokenizerFactory'] | undefined,
  content: SessionClientOwner['contentGeneratorFactory'] | undefined,
  files: ProviderFileLifecycle | undefined,
  bus: ConstructorParameters<typeof SessionClientOwner>[11],
): Promise<AgentActivationBootstrap> {
  client?.assertConfig(config);
  client?.assertProviderManager(manager);
  const { ownedTrust, workspaceTrust } = resolveActivationTrust(
    config,
    mcp,
    suppliedTrust,
  );

  const cleanupTrust = resolveTrustCleanup(ownedTrust, trustCleanup);
  if (mcp === undefined && cleanupTrust !== undefined)
    release.acquire('settings', cleanupTrust);
  const owner = acquireActivationSettings(
    config,
    settings,
    suppliedSettings,
    settingsOwnership,
    release,
  );
  const mediaOwner = acquireActivationMedia(config, client, release);
  return completeWorkspaceActivation(
    config,
    settings,
    manager,
    client,
    mcp,
    suppliedFilesystem,
    suppliedMemory,
    owner,
    mediaOwner,
    workspaceTrust,
    cleanupTrust,
    settingsOwnership,
    memoryOwnership,
    release,
    oauth,
    readKind,
    providerLifetime,
    tokenizer,
    content,
    files,
    bus,
  );
}

async function completeWorkspaceActivation(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  client: AgentClientContract | undefined,
  mcp: McpRuntimeOwner | undefined,
  suppliedFilesystem: WorkspaceFilesystemOwner | undefined,
  suppliedMemory: WorkspaceMemoryOwner | undefined,
  owner: SessionSettingsOwner,
  mediaOwner: SessionMediaOwner | undefined,
  workspaceTrust: WorkspaceTrustControlPort,
  cleanupTrust: (() => Promise<void>) | undefined,
  settingsOwnership: 'borrowed' | 'transferred',
  memoryOwnership: 'borrowed' | 'transferred',
  release: AcquisitionRelease,
  oauth: OAuthManager | null,
  readKind: () => RuntimeKind | undefined,
  providerLifetime: 'borrowed' | (() => Promise<void>),
  tokenizer: SessionClientOwner['tokenizerFactory'] | undefined,
  content: SessionClientOwner['contentGeneratorFactory'] | undefined,
  files: ProviderFileLifecycle | undefined,
  bus: ConstructorParameters<typeof SessionClientOwner>[11],
): Promise<AgentActivationBootstrap> {
  const workspaceFilesystem = acquireActivationFilesystem(
    config,
    mcp,
    suppliedFilesystem,
    workspaceTrust,
    release,
  );
  const ownedMemory = resolveActivationMemoryOwnership(
    mcp,
    suppliedMemory,
    memoryOwnership,
  );
  const workspaceMemory = acquireActivationMemory(
    config,
    mcp,
    suppliedMemory,
    workspaceFilesystem,
    workspaceTrust,
    ownedMemory,
    release,
  );
  const workspaceDefinitions = acquireActivationDefinitions(
    config,
    mcp,
    release,
  );
  return completeActivationAcquisition(
    config,
    settings,
    manager,
    oauth,
    readKind,
    providerLifetime,
    client,
    mcp,
    requirePreflightMedia(client, mediaOwner),
    owner,
    mediaOwner,
    workspaceFilesystem,
    workspaceMemory,
    workspaceDefinitions,
    workspaceTrust,
    cleanupTrust,
    settingsOwnership,
    content,
    tokenizer,
    files,
    bus,
    ownedMemory,
    release,
  );
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

function bindActivationCapabilities(
  sessionClient: Pick<
    SessionClientOwner,
    | 'bindProviderFiles'
    | 'bindMcpRuntime'
    | 'bindHooks'
    | 'bindDefinitionReads'
    | 'bindWorkspaceInstructions'
  >,
  files: ProviderFileLifecycle,
  oauth: OAuthManager | null,
  workspaceDefinitions: WorkspaceDefinitionOwner,
  workspaceMemory: WorkspaceMemoryOwner,
  mcpRuntime: McpRuntimeOwner | undefined,
): void {
  sessionClient.bindProviderFiles(
    files,
    (provider) => oauth?.composeRetryOperations(provider) ?? {},
    (scope) => cleanupProviderScope(files, scope),
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

function acquireActivationFiles(
  supplied: ProviderFileLifecycle | undefined,
  proxy: string | undefined,
): ProviderFileLifecycle {
  return (
    supplied ??
    new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
      proxy,
    })
  );
}
