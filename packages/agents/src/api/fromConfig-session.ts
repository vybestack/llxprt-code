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
import { cleanupProviderScope } from '../session/session-client-cleanup.js';
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

export interface ActivationSessionClient {
  readonly client: SessionClientOwner;
  readonly switcher: ProviderSwitcher;
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
    session: ActivationSessionClient,
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
      client,
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
      { client, switcher },
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
  client: SessionClientOwner,
): ProviderSwitcher {
  const { files } = activation;
  assembleSessionImages(
    {
      hasImageComposition: () => client.hasImageComposition(),
      bindImageOperation: (run, dispose) =>
        client.bindImageOperation(run, dispose),
    },
    config.getTargetDir(),
    providers.manager,
    auth.oauth,
    providers.settings,
  );
  client.clients.bindProviderFiles(
    files,
    (provider) => auth.oauth.composeRetryOperations(provider),
    (scope) => cleanupProviderScope(files, scope),
  );
  client.clients.bindDefinitionReads(
    definitions.profileReads,
    definitions.subagentReads,
  );
  client.bindWorkspaceInstructions(activation.memory);
  return assembleProviderSwitch(
    config,
    providers.settings,
    providers.manager,
    auth.oauth,
    activation.readKind,
    () => client.clients.refreshAuth(),
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
