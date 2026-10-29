/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path';
import type {
  Config,
  ProviderSwitcher,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { acquireSessionClient } from '../session/session-client-binding.js';
import {
  cleanupProviderScope,
  rethrowAfterCleanup,
} from '../session/session-client-cleanup.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type {
  PreflightActivationInput,
  PreflightAuthInput,
  PreflightProviderInput,
  PreflightSettingsInput,
} from './activationPreflightState.js';
import type { ProviderActivationIntent } from './config-types.js';
import { assembleModelSelection } from './model-selection.js';
import {
  executeProviderActivation,
  type ProviderActivationResult,
} from './providerActivationExecutor.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import { assembleSessionImages } from './session-image-assembly.js';

export interface ActivationSessionResources {
  workspaceTrust: WorkspaceTrustControlPort;
  trustCleanup: (() => Promise<void>) | undefined;
  settingsOwner: SessionSettingsOwner;
  settingsOwnership: 'borrowed' | 'transferred';
  media: SessionMediaOwner;
  workspaceFilesystem: WorkspaceFilesystemOwner;
  workspaceMemory: WorkspaceMemoryOwner;
  workspaceDefinitions: WorkspaceDefinitionOwner;
}

/**
 * Acquires the session resources of a preflight activation. On failure it
 * rolls back what it acquired; on success the caller owns retirement of the
 * returned resources, so nothing here closes them.
 */
export async function acquireActivationSession<T>(
  config: Config,
  activation: PreflightActivationInput,
  settings: PreflightSettingsInput,
  providers: PreflightProviderInput,
  auth: PreflightAuthInput,
  complete: (
    resources: ActivationSessionResources,
    client: SessionClientOwner,
    switcher: ProviderSwitcher,
  ) => T,
): Promise<T> {
  const release = new AcquisitionRelease();
  try {
    if (activation.trustCleanup !== undefined)
      release.acquire('settings', activation.trustCleanup);
    const media = acquireActivationSettings(
      config,
      release,
      settings,
      providers,
    );
    const definitions = acquireActivationWorkspace(config, release, activation);
    const client = await acquireActivationClient(
      config,
      release,
      activation,
      providers,
      auth,
      settings.settingsOwner,
      media,
    );
    const switcher = bindActivationClient(
      config,
      activation,
      providers,
      auth,
      settings.settingsOwner,
      definitions,
      {
        images: {
          hasImageComposition: client.hasImageComposition,
          bindImageOperation: client.bindImageOperation.bind(client),
        },
        bindProviderFiles: client.clients.bindProviderFiles.bind(
          client.clients,
        ),
        bindDefinitionReads: client.clients.bindDefinitionReads.bind(
          client.clients,
        ),
        bindWorkspaceInstructions:
          client.bindWorkspaceInstructions.bind(client),
        refreshAuth: client.operations.refreshAuth,
      },
    );
    return complete(
      {
        workspaceTrust: activation.trust,
        trustCleanup: activation.trustCleanup,
        settingsOwner: settings.settingsOwner,
        settingsOwnership: settings.settingsOwnership,
        media,
        workspaceFilesystem: activation.filesystem,
        workspaceMemory: activation.memory,
        workspaceDefinitions: definitions,
      },
      client,
      switcher,
    );
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      () => release.rollback(),
      'Activation acquisition cleanup failed',
    );
  }
}

function acquireActivationSettings(
  config: Config,
  release: AcquisitionRelease,
  settings: PreflightSettingsInput,
  providers: PreflightProviderInput,
): SessionMediaOwner {
  const owner = settings.settingsOwner;
  owner.assertSettingsIdentity(providers.settings);
  if (settings.settingsOwnership === 'transferred')
    release.acquire('settings', () => owner.dispose());
  owner.bindTelemetry(config);
  const media = new SessionMediaOwner(
    config.projectTempDir,
    config.getMediaStoreQuotaByteLimit(),
  );
  release.acquire('settings', () => media.dispose());
  return media;
}

function acquireActivationWorkspace(
  config: Config,
  release: AcquisitionRelease,
  activation: PreflightActivationInput,
): WorkspaceDefinitionOwner {
  const { filesystem, memory } = activation;
  release.acquire('settings', () => filesystem.dispose());
  release.acquire('settings', () => memory.dispose());
  const definitions = new WorkspaceDefinitionOwner(
    config.profileDirectory ?? join(config.globalConfigRoot, 'profiles'),
    config.subagentDirectory ?? join(config.globalConfigRoot, 'subagents'),
  );
  release.acquire('settings', () => definitions.dispose());
  return definitions;
}

async function acquireActivationClient(
  config: Config,
  release: AcquisitionRelease,
  activation: PreflightActivationInput,
  providers: PreflightProviderInput,
  auth: PreflightAuthInput,
  settingsOwner: SessionSettingsOwner,
  media: SessionMediaOwner,
): Promise<SessionClientOwner> {
  const client = await acquireSessionClient(
    {
      config,
      messageBus: activation.bus,
      workspacePaths: activation.filesystem.paths,
      readInstructions: () => undefined,
      imageOperation: undefined,
    },
    { settings: providers.settings, settingsOwner },
    providers.manager,
    auth.oauth,
    {
      contentGeneratorFactory: createRuntimeContentGeneratorFactory(),
      tokenizerFactory: configureProviderTokenizer(
        providers.manager,
        undefined,
      ),
      providerFiles: activation.files,
      mediaStore: media.store,
      authority: activation.authority,
      clientFactory: undefined,
    },
  );
  release.acquire('manager', () => client.dispose());
  client.clients.adoptProviderLifetime(activation.providerLifetime);
  return client;
}

function bindActivationClient(
  config: Config,
  activation: PreflightActivationInput,
  providers: PreflightProviderInput,
  auth: PreflightAuthInput,
  settingsOwner: SessionSettingsOwner,
  definitions: WorkspaceDefinitionOwner,
  binding: {
    readonly images: Parameters<typeof assembleSessionImages>[0];
    readonly bindProviderFiles: SessionClientOwner['clients']['bindProviderFiles'];
    readonly bindDefinitionReads: SessionClientOwner['clients']['bindDefinitionReads'];
    readonly bindWorkspaceInstructions: SessionClientOwner['bindWorkspaceInstructions'];
    readonly refreshAuth: (method?: string) => Promise<void>;
  },
): ProviderSwitcher {
  const { files } = activation;
  assembleSessionImages(
    binding.images,
    config.getTargetDir(),
    providers.manager,
    auth.oauth,
    providers.settings,
  );
  binding.bindProviderFiles(
    files,
    (provider) => auth.oauth.composeRetryOperations(provider),
    (scope) => cleanupProviderScope(files, scope),
  );
  binding.bindDefinitionReads(
    definitions.profileReads,
    definitions.subagentReads,
  );
  binding.bindWorkspaceInstructions(activation.memory);
  return assembleProviderSwitch(
    config,
    providers.settings,
    providers.manager,
    auth.oauth,
    activation.readKind,
    binding.refreshAuth,
    settingsOwner,
  );
}

export async function executeActivationSession(
  config: Config,
  intent: ProviderActivationIntent,
  switcher: ProviderSwitcher,
  providers: PreflightProviderInput,
  resources: {
    readonly settingsOwner: SessionSettingsOwner;
    readonly refreshAuth: SessionClientOwner['clients']['refreshAuth'];
  },
): Promise<ProviderActivationResult> {
  await resources.settingsOwner.startTelemetry(config);
  return executeProviderActivation(
    config,
    intent,
    switcher,
    providers.settings,
    providers.manager,
    resources.refreshAuth,
    assembleModelSelection(resources.settingsOwner),
  );
}
