import { join } from 'node:path';
import {
  WorkspaceDefinitionOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProviderActivationIntent } from './config-types.js';
import { assembleSessionImages } from './session-image-assembly.js';
import { cleanupProviderScope } from '../session/session-client-cleanup.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ContentGenerator,
  MessageBus,
  RuntimeContentGeneratorFactory,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
  ProviderSwitcher,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import {
  createFileOAuthSettingsProvider,
  type CredentialAuthority,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  populateProviderManager,
  NodeFileSystem,
  createOwnerOAuthManager,
  createSessionAuthPolicyReader,
  createOAuthProfileReads,
  createOwnedTokenStoreClose,
  createOwnerAuthCacheInvalidator,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { acquireSessionClient } from '../session/session-client-binding.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import { AgentBootstrapError } from './agentBootstrap.js';
import type { AgentAdoptionIntent } from './config-types.js';
import { ForegroundAssembly } from './foreground-agent-assembly.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { assembleModelSelection } from './model-selection.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';

export abstract class AdoptedSessionAssembly extends ForegroundAssembly {
  protected abstract adoptSettingsService: SettingsService;
  protected abstract adoptIntent: AgentAdoptionIntent;

  protected adoptClient!: SessionClientOwner;
  protected adoptMcp!: McpRuntimeOwner;
  protected adoptMedia: SessionMediaOwner | undefined;
  protected adoptSelectedSettings!: SessionSettingsOwner;
  protected adoptFiles!: ProviderFileLifecycle;
  protected adoptManager!: RuntimeProviderManager;
  protected adoptOauth!: OAuthManager;
  protected adoptTokenizer!: RuntimeTokenizerFactory;
  protected adoptContent!: RuntimeContentGeneratorFactory<ContentGenerator>;

  protected adoptRuntimeId!: string;
  protected adoptAuthority!: CredentialAuthority;
  protected foregroundAuthority!: CredentialAuthority;
  protected abstract adoptRelease: AcquisitionRelease;
  protected adoptOAuthBus!: MessageBus;

  protected acquireAdoptedProviderManager(): void {
    const network = new OwnedFetch(this.config.getProxy());
    this.adoptRelease.beforeRelease(() => network.closeAdmissionAndAbort());
    this.adoptRelease.acquire('network', () => network.dispose());
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      this.adoptFiles,
      this.adoptSettingsService,
      this.config,
      this.adoptionProviderContext(),
      undefined,
      this.adoptSelectedSettings,
    );
    manager.bindNetworkFetch(network.fetch);
    this.adoptRelease.acquire('manager', () => manager.dispose());
    const storage = this.adoptAuthority.createProviderKeyStorage();
    this.adoptRelease.acquire('manager', () => storage.close());
    manager.bindProviderKeyStorage(storage);
    this.adoptManager = manager;
  }

  protected acquireAdoptedOAuth(): void {
    const requestFetch = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => this.adoptManager.fetchNetwork(input, init);
    const store = this.adoptAuthority.createTokenStore();
    this.adoptRelease.acquire('tokens', createOwnedTokenStoreClose(store));
    const oauth = createOwnerOAuthManager(
      store,
      createFileOAuthSettingsProvider(),
      this.adoptOAuthBus,
      createOAuthProfileReads(this.config.profileDirectory),
      createSessionAuthPolicyReader(this.adoptSettingsService),
      () => ({ runtimeId: this.adoptRuntimeId, runtimeKind: 'agent' }),
      undefined,
      createOwnerAuthCacheInvalidator((name) =>
        this.adoptManager.getProviderByName(name),
      ),
      requestFetch,
    );
    this.adoptRelease.acquire('oauth', () => oauth.dispose());
    this.adoptOauth = oauth;
  }

  protected async activateAdoptedProviders(): Promise<void> {
    await this.adoptSelectedSettings.startTelemetry(this.config);
    this.adoptManager.setRetryOperationsFactory?.((providerName, profileId) =>
      this.adoptOauth.composeRetryOperations(
        providerName,
        profileId ? { profileId } : undefined,
      ),
    );
    this.adoptManager.setRuntimeContext(
      this.adoptionProviderContext(),
      this.adoptSelectedSettings,
      this.adoptSettingsService,
      this.config,
    );
    if (!(this.adoptManager instanceof ProviderManager))
      throw new Error(
        'Owned provider population requires its concrete manager',
      );
    populateProviderManager(
      this.adoptManager,
      this.adoptOauth,
      this.adoptOauth.getTokenStore(),
      this.adoptSettingsService,
      new NodeFileSystem(),
      this.config,
      undefined,
      undefined,
      false,
      false,
      process.env.LLXPRT_FAKE_RESPONSES,
    );
    this.adoptManager.setTokenizerFactory(this.adoptTokenizer);
    this.adoptManager.setConfig(this.config);
  }

  private adoptionProviderContext() {
    return createProviderRuntimeContext({
      runtimeId: this.adoptRuntimeId,
      runtimeKind: 'agent',
      metadata: { source: 'cli-isolated-runtime-factory' },
    });
  }

  protected activationSettings!: SettingsService;
  protected activationManager!: RuntimeProviderManager;
  protected activationOAuth: OAuthManager | null = null;
  protected activationReadKind!: () => RuntimeKind | undefined;
  protected activationProviderLifetime!: 'borrowed' | (() => Promise<void>);
  protected activationFilesystem: WorkspaceFilesystemOwner | undefined;
  protected activationMemory: WorkspaceMemoryOwner | undefined;
  protected activationSettingsOwner: SessionSettingsOwner | undefined;
  protected activationSettingsOwnership: 'borrowed' | 'transferred' =
    'transferred';
  protected activationTrust: WorkspaceTrustControlPort | undefined;
  protected activationTrustCleanup: (() => Promise<void>) | undefined;
  protected activationFiles: ProviderFileLifecycle | undefined;
  protected activationBus: MessageBus | undefined;
  protected activationSwitch!: ProviderSwitcher;
  readonly #activationRelease = new AcquisitionRelease();

  protected async acquireActivation(): Promise<void> {
    try {
      this.acquireActivationTrust();
      this.acquireActivationSettings();
      this.acquireActivationWorkspace();
      await this.acquireActivationClient();
      this.bindActivationClient();
    } catch (error) {
      try {
        await this.#activationRelease.rollback();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Activation acquisition cleanup failed',
        );
      }
      throw error;
    }
  }

  private acquireActivationTrust(): void {
    const ownedTrust =
      this.activationTrust === undefined
        ? new WorkspaceTrustLifecycle({
            localTrust: this.config.initialWorkspaceTrust,
          })
        : undefined;
    const trust = this.activationTrust ?? ownedTrust;
    if (trust === undefined)
      throw new Error('Preflight requires an explicit trust authority');
    this.workspaceTrust = trust;
    this.trustCleanup =
      ownedTrust === undefined
        ? this.activationTrustCleanup
        : () => ownedTrust.dispose();
    if (this.trustCleanup !== undefined)
      this.#activationRelease.acquire('settings', this.trustCleanup);
  }

  private acquireActivationSettings(): void {
    const owner =
      this.activationSettingsOwner ??
      new SessionSettingsOwner(this.activationSettings);
    owner.assertSettingsIdentity(this.activationSettings);
    this.settingsOwner = owner;
    this.settingsOwnerOwnership = this.activationSettingsOwnership;
    if (this.activationSettingsOwnership === 'transferred')
      this.#activationRelease.acquire('settings', () => owner.dispose());
    owner.bindTelemetry(this.config);
    const media = new SessionMediaOwner(
      this.config.projectTempDir,
      this.config.getMediaStoreQuotaByteLimit(),
    );
    this.mediaOwner = media;
    this.#activationRelease.acquire('settings', () => media.dispose());
  }

  private acquireActivationWorkspace(): void {
    const filesystem =
      this.activationFilesystem ??
      new WorkspaceFilesystemOwner({
        targetDir: this.config.getTargetDir(),
        customExcludes: this.config.customExcludes,
        includeDirectories: this.config.getConfiguredIncludeDirectories(),
        isTrusted: () => this.workspaceTrust.isTrustedFolder(),
      });
    this.workspaceFilesystem = filesystem;
    this.ownsFilesystem = true;
    this.#activationRelease.acquire('settings', () => filesystem.dispose());
    const memory =
      this.activationMemory ??
      assembleWorkspaceMemory(this.config, filesystem, this.workspaceTrust);
    this.workspaceMemory = memory;
    this.workspaceMemoryOwnership = 'transferred';
    this.ownsMemory = true;
    this.#activationRelease.acquire('settings', () => memory.dispose());
    const definitions = new WorkspaceDefinitionOwner(
      this.config.profileDirectory ??
        join(this.config.globalConfigRoot, 'profiles'),
      this.config.subagentDirectory ??
        join(this.config.globalConfigRoot, 'subagents'),
    );
    this.workspaceDefinitions = definitions;
    this.ownsDefinitions = true;
    this.#activationRelease.acquire('settings', () => definitions.dispose());
    this.providerFileLifecycle =
      this.activationFiles ??
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
        proxy: this.config.getProxy(),
      });
  }

  private async acquireActivationClient(): Promise<void> {
    const media = this.mediaOwner;
    if (media === undefined)
      throw new Error('Preflight requires an explicit session media store');
    const files = this.providerFileLifecycle;
    if (files === undefined)
      throw new Error('Activation provider files are not acquired');
    const client = await acquireSessionClient(
      this.config,
      this.activationSettings,
      this.settingsOwner,
      this.activationManager,
      this.activationOAuth ?? undefined,
      createRuntimeContentGeneratorFactory(),
      configureProviderTokenizer(this.activationManager, undefined),
      files,
      media.store,
      undefined,
      () => undefined,
      this.workspaceFilesystem.paths,
      this.foregroundAuthority,
      this.activationBus,
    );
    this.ownedSessionClient = client;
    this.#activationRelease.acquire('manager', () => client.dispose());
    client.adoptProviderLifetime(this.activationProviderLifetime);
  }

  private bindActivationClient(): void {
    const client = this.ownedSessionClient;
    const files = this.providerFileLifecycle;
    if (files === undefined)
      throw new Error('Activation provider files are not acquired');
    assembleSessionImages(
      {
        hasImageComposition: () => client.hasImageComposition(),
        bindImageOperation: (run, dispose) =>
          client.bindImageOperation(run, dispose),
      },
      this.config.getTargetDir(),
      this.activationManager,
      this.activationOAuth ?? undefined,
      this.activationSettings,
    );
    client.bindProviderFiles(
      files,
      (provider) =>
        this.activationOAuth?.composeRetryOperations(provider) ?? {},
      (scope) => cleanupProviderScope(files, scope),
    );
    client.bindDefinitionReads(
      this.workspaceDefinitions.profileReads,
      this.workspaceDefinitions.subagentReads,
    );
    client.bindWorkspaceInstructions(this.workspaceMemory);
    this.oauthManager = this.activationOAuth ?? undefined;
    this.messageBus = this.activationBus;
    this.activationSwitch = assembleProviderSwitch(
      this.config,
      this.activationSettings,
      this.activationManager,
      this.activationOAuth,
      this.activationReadKind,
      () => client.refreshAuth(),
      this.settingsOwner,
    );
  }

  protected async executeActivation(intent: ProviderActivationIntent) {
    await this.settingsOwner.startTelemetry(this.config);
    return executeProviderActivation(
      this.config,
      intent,
      this.activationSwitch,
      this.activationSettings,
      this.activationManager,
      (method) => this.ownedSessionClient.refreshAuth(method),
      assembleModelSelection(this.settingsOwner),
    );
  }

  protected async acquireAdoptedSession(): Promise<void> {
    this.adoptSelectedSettings.initializeProviderSelection(
      this.adoptIntent.activation?.provider ?? this.config.getProvider(),
      this.adoptIntent.activation?.model ?? this.config.getModel(),
    );
    const store = this.adoptMedia?.store;
    if (store === undefined)
      throw new AgentBootstrapError(
        'Missing explicit session client media store',
      );
    this.adoptClient = await acquireSessionClient(
      this.config,
      this.adoptSettingsService,
      this.adoptSelectedSettings,
      this.adoptManager,
      this.adoptOauth,
      this.adoptContent,
      this.adoptTokenizer,
      this.adoptFiles,
      store,
      undefined,
      this.adoptMcp.readInstructions,
      this.adoptMcp.workspacePaths,
      this.adoptAuthority,
    );
  }

  protected async activateAdoptedSession(): Promise<void> {
    const switchProvider = assembleProviderSwitch(
      this.config,
      this.adoptSettingsService,
      this.adoptManager,
      this.adoptOauth,
      () => 'agent',
      () => this.adoptClient.refreshAuth(),
      this.adoptSelectedSettings,
    );
    const activation = this.adoptIntent.activation;
    if (activation !== undefined) {
      const result = await executeProviderActivation(
        this.config,
        activation,
        switchProvider,
        this.adoptSettingsService,
        this.adoptManager,
        (method) => this.adoptClient.refreshAuth(method),
        assembleModelSelection(this.adoptSelectedSettings),
      );
      if (result.authFailed) {
        const underlying = result.authError;
        throw new AgentBootstrapError(
          `fromConfig activation failed: ${underlying instanceof Error ? underlying.message : String(underlying)}`,
          { cause: underlying },
        );
      }
    } else if (!this.adoptClient.isClientInitialized()) {
      await this.adoptClient.refreshAuth(undefined);
    }
  }
}
