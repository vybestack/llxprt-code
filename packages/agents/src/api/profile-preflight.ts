/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SessionSettingsOwner,
  type Config,
  type RuntimeProviderManager,
  type WorkspaceTrustControlPort,
  type WorkspaceFilesystemOwner,
  type WorkspaceMemoryOwner,
} from '@vybestack/llxprt-code-core';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import {
  createFileOAuthSettingsProvider,
  CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import {
  ProviderManager,
  ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import { createOwnerPolicyEvaluation } from '@vybestack/llxprt-code-core/policy/owner-policy-evaluation.js';
import { createSessionMessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import {
  populateProviderManager,
  NodeFileSystem,
  createOwnerOAuthManager,
  createSessionAuthPolicyReader,
  createOwnedTokenStoreClose,
  createOwnerAuthCacheInvalidator,
  createPreflightOAuthProfileReads,
} from '@vybestack/llxprt-code-providers/composition.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import { applyCliArgumentOverrides } from './settingsResolver.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import {
  captureAgentPreflightHostInput,
  type AgentPreflightHostInput,
} from './preflight-host-input.js';
import {
  assembleAgentActivationBootstrap,
  assembleProviderSwitch,
} from './providerSwitchAssembly.js';
import {
  assembleProfileApplication,
  type AgentProfileApplication,
} from './profileApplicationAssembly.js';
import type { AgentActivationOperation } from './activationPreflightState.js';

export interface AgentPostConfigSettings {
  writeUserParameter(key: string, value: unknown): void;
  readNamedParameter(key: string): unknown;
  chooseModel(model: string): void;
}

export class AgentProfilePreflight implements AgentPostConfigSettings {
  readonly #host: AgentPreflightHostInput;
  readonly #settings: SettingsService;
  readonly #release = new AcquisitionRelease();
  readonly #decisions = createOwnerPolicyEvaluation();
  readonly #bus = createSessionMessageBus(this.#decisions);
  readonly #files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  readonly #profileReads = createPreflightOAuthProfileReads();
  #manager!: ProviderManager;
  #oauth!: OAuthManager;
  #phase: 'pre-config' | 'configured' | 'transferred' | 'closed' = 'pre-config';
  #closing: Promise<void> | undefined;
  #sessionSettings: SessionSettingsOwner | undefined;
  #activation: AgentActivationOperation | undefined;
  #switch: ProviderSwitcher | undefined;
  #profiles: AgentProfileApplication | undefined;
  #ownsSettings = false;
  #activationTransferred = false;

  private constructor(
    host: AgentPreflightHostInput,
    settings: SettingsService,
  ) {
    this.#host = host;
    this.#settings = settings;
    this.#release.acquire('bus', () => this.#bus.cancelPendingConfirmations());
    this.#release.acquire('files', () =>
      releaseAdoptedFileScope(this.#files, host.runtimeId),
    );
  }

  static async create(
    host: AgentPreflightHostInput,
    authority: CredentialAuthority,
    suppliedSettings: SettingsService | undefined,
    settingsOwner: SessionSettingsOwner | undefined,
    contributions: ProviderContributionRegistry | undefined,
    oauthSettings: IOAuthSettingsProvider | undefined,
  ): Promise<AgentProfilePreflight> {
    const captured = captureAgentPreflightHostInput(host);
    if (!(authority instanceof CredentialAuthority))
      throw new Error('Preflight requires CredentialAuthority');
    const settings = suppliedSettings ?? new SettingsService();
    settingsOwner?.assertSettingsIdentity(settings);
    const operation = new AgentProfilePreflight(captured, settings);
    try {
      for (const [key, value] of Object.entries(captured.initialSettings ?? {}))
        settings.set(key, value);
      operation.#acquire(
        authority,
        contributions,
        oauthSettings ?? createFileOAuthSettingsProvider(),
        process.env.LLXPRT_FAKE_RESPONSES,
      );
      return operation;
    } catch (error) {
      operation.#phase = 'closed';
      try {
        await operation.#release.rollback();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Preflight acquisition cleanup failed',
        );
      }
      throw error;
    }
  }

  #runtimeContext(stage: 'pre-config' | 'post-config') {
    return createProviderRuntimeContext({
      runtimeId: this.#host.runtimeId,
      runtimeKind:
        this.#host.metadata?.source === 'cli-bootstrap'
          ? 'cli-bootstrap'
          : 'cli-interactive',
      metadata:
        stage === 'post-config'
          ? { ...this.#host.metadata, stage }
          : this.#host.metadata,
    });
  }

  #acquire(
    authority: CredentialAuthority,
    contributions: ProviderContributionRegistry | undefined,
    oauthSettings: IOAuthSettingsProvider | undefined,
    fakeResponses: string | undefined,
  ): void {
    this.#manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      this.#files,
      this.#settings,
      undefined,
      this.#runtimeContext('pre-config'),
    );
    const manager = this.#manager;
    this.#release.acquire('manager', () => manager.dispose());
    const keys = authority.createProviderKeyStorage();
    this.#release.acquire('manager', () => keys.close());
    manager.bindProviderKeyStorage(keys);
    const tokens = authority.createTokenStore();
    this.#release.acquire('tokens', createOwnedTokenStoreClose(tokens));
    const oauth = createOwnerOAuthManager(
      tokens,
      oauthSettings,
      this.#bus,
      this.#profileReads,
      createSessionAuthPolicyReader(this.#settings),
      () => manager.getAuthIdentity(),
      undefined,
      createOwnerAuthCacheInvalidator((name) =>
        manager.getProviderByName(name),
      ),
      manager.fetchNetwork,
    );
    this.#oauth = oauth;
    this.#release.acquire('oauth', () => oauth.dispose());
    populateProviderManager(
      manager,
      oauth,
      tokens,
      this.#settings,
      new NodeFileSystem(),
      undefined,
      contributions,
      undefined,
      false,
      true,
      fakeResponses,
    );
  }

  retainProviderFile(
    input: Omit<Parameters<ProviderFileLifecycle['retain']>[0], 'scopeId'>,
  ): ReturnType<ProviderFileLifecycle['retain']> {
    this.#assertOpen();
    return this.#files.retain({ ...input, scopeId: this.#host.runtimeId });
  }

  captureProviderFiles(): ReturnType<ProviderFileLifecycle['snapshot']> {
    return this.#files.snapshot();
  }

  retryProviderFileCleanup(): ReturnType<
    ProviderFileLifecycle['retryDeletions']
  > {
    return this.#files.retryDeletions();
  }

  #assertOpen(): void {
    if (this.#phase === 'closed')
      throw new Error('Agent profile preflight is disposed');
  }

  captureInput(): AgentPreflightHostInput {
    this.#assertOpen();
    return this.#host;
  }

  captureSettings(): Record<string, unknown> {
    this.#assertOpen();
    return this.#settings.getAllGlobalSettings();
  }

  readProviderDefaultModel(provider: string): string | undefined {
    this.#assertOpen();
    const manager = this.#manager;
    return manager.getProviderByName(provider)?.getDefaultModel();
  }

  chooseProviderModel(provider: string, model: string): void {
    this.#assertOpen();
    this.#settings.setProviderSetting(provider, 'model', model);
  }

  readSetting(key: string): unknown {
    this.#assertOpen();
    return this.#settings.get(key);
  }

  writeSetting(key: string, value: unknown): void {
    this.#assertOpen();
    this.#settings.set(key, value);
  }

  async applyArgumentOverrides(
    config: Config,
    owner: Pick<SessionSettingsOwner, 'writeUserParameter'>,
    argv: Parameters<typeof applyCliArgumentOverrides>[0],
    bootstrap: Parameters<typeof applyCliArgumentOverrides>[1],
  ): Promise<void> {
    this.#assertOpen();
    await applyCliArgumentOverrides(
      argv,
      bootstrap,
      {
        getProviderKeys: () => config.getProviderKeys(),
        setEphemeralSetting: (key, value) =>
          owner.writeUserParameter(key, value),
      },
      this.#settings,
      this.#manager.getActiveProvider(),
    );
  }

  private async bindConfig(
    config: Config,
    trust: WorkspaceTrustControlPort,
    owner: SessionSettingsOwner,
    onPolicyOwnerReady: ((policy: RuntimePolicyOwner) => void) | undefined,
    onProviderManagerReady:
      | ((manager: RuntimeProviderManager) => void)
      | undefined,
    onOAuthManagerReady:
      | ((oauth: OAuthManager | undefined) => void)
      | undefined,
    onProviderFilesReady: ((files: ProviderFileLifecycle) => void) | undefined,
  ): Promise<void> {
    this.#assertOpen();
    owner.assertSettingsIdentity(this.#settings);
    const policy = new RuntimePolicyOwner(config, trust, undefined, this.#bus);
    this.#release.acquire('policy', () => policy.dispose());
    const configScope = config.getSessionId();
    if (configScope !== this.#host.runtimeId)
      this.#release.acquire('files', () =>
        releaseAdoptedFileScope(this.#files, configScope),
      );
    owner.bindTelemetry(config);
    const selected =
      this.#settings.get('activeProvider') ?? config.getProvider();
    if (selected !== undefined) {
      if (typeof selected !== 'string')
        throw new TypeError('Active provider must be a string');
      try {
        this.#manager.setActiveProvider(selected);
      } catch (error) {
        throw new Error(
          `Could not activate explicitly-configured provider '${selected}': ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
    this.#manager.setRuntimeContext(
      this.#runtimeContext('post-config'),
      owner,
      this.#settings,
      config,
    );
    this.#manager.setConfig(config);
    this.#profileReads.attachProfileDirectory(config.profileDirectory);
    this.#decisions.bindPolicyEvaluation((name, args, server) =>
      policy.session.decisions.evaluate(name, args, server),
    );
    onPolicyOwnerReady?.(policy);
    onProviderManagerReady?.(this.#manager);
    onOAuthManagerReady?.(this.#oauth);
    onProviderFilesReady?.(this.#files);
  }

  async preparePostConfiguration(
    config: Config,
    filesystem: WorkspaceFilesystemOwner,
    memory: WorkspaceMemoryOwner,
    trust: WorkspaceTrustControlPort,
    trustCleanup: (() => Promise<void>) | undefined,
    suppliedSettings?: SessionSettingsOwner,
    onPolicyOwnerReady?: (policy: RuntimePolicyOwner) => void,
    onProviderManagerReady?: (manager: RuntimeProviderManager) => void,
    onOAuthManagerReady?: (oauth: OAuthManager | undefined) => void,
    onProviderFilesReady?: (files: ProviderFileLifecycle) => void,
  ): Promise<void> {
    this.#assertOpen();
    if (this.#sessionSettings !== undefined)
      throw new Error('Post-config preflight is already prepared');
    this.#ownsSettings = suppliedSettings === undefined;
    this.#sessionSettings =
      suppliedSettings ?? new SessionSettingsOwner(this.#settings);
    try {
      await this.bindConfig(
        config,
        trust,
        this.#sessionSettings,
        onPolicyOwnerReady,
        onProviderManagerReady,
        onOAuthManagerReady,
        onProviderFilesReady,
      );
      await this.#prepareActivation(
        config,
        filesystem,
        memory,
        this.#sessionSettings,
        this.#ownsSettings ? 'transferred' : 'borrowed',
        trust,
        trustCleanup,
      );
      this.#phase = 'configured';
    } catch (error) {
      try {
        await this.dispose();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Post-config preflight cleanup failed',
        );
      }
      throw error;
    }
  }

  writeUserParameter(key: string, value: unknown): void {
    this.#assertOpen();
    if (this.#sessionSettings === undefined)
      throw new Error('Post-config preflight is not prepared');
    this.#sessionSettings.writeUserParameter(key, value);
  }

  readNamedParameter(key: string): unknown {
    this.#assertOpen();
    if (this.#sessionSettings === undefined)
      throw new Error('Post-config preflight is not prepared');
    return this.#sessionSettings.readNamedParameter(key);
  }

  chooseModel(model: string): void {
    this.#assertOpen();
    if (this.#sessionSettings === undefined)
      throw new Error('Post-config preflight is not prepared');
    this.#sessionSettings.chooseModel(model);
  }

  preflight(
    intent: Parameters<AgentActivationOperation['preflight']>[0],
  ): ReturnType<AgentActivationOperation['preflight']> {
    this.#assertOpen();
    if (this.#activation === undefined)
      throw new Error('Post-config preflight is not prepared');
    return this.#activation.preflight(intent);
  }

  captureSwitchOperation(): ProviderSwitcher {
    this.#assertOpen();
    if (this.#switch === undefined)
      throw new Error('Post-config preflight is not prepared');
    return this.#switch;
  }

  captureProfileOperation(): AgentProfileApplication {
    this.#assertOpen();
    if (this.#profiles === undefined)
      throw new Error('Post-config preflight is not prepared');
    return this.#profiles;
  }

  transferActivation(
    ready: (operation: AgentActivationOperation) => void,
  ): void {
    this.#assertOpen();
    if (this.#activation === undefined || this.#activationTransferred)
      throw new Error('Post-config activation is unavailable for transfer');
    ready(this.#activation);
    this.#activationTransferred = true;
    this.#phase = 'transferred';
  }

  async finishPostConfiguration(): Promise<void> {
    if (!this.#activationTransferred) await this.#activation?.dispose();
  }

  async #prepareActivation(
    config: Config,
    filesystem: WorkspaceFilesystemOwner,
    memory: WorkspaceMemoryOwner,
    settingsOwner: SessionSettingsOwner,
    settingsOwnership: 'borrowed' | 'transferred',
    trust: WorkspaceTrustControlPort,
    trustCleanup: (() => Promise<void>) | undefined,
  ): Promise<void> {
    this.#assertOpen();
    this.#activation = await assembleAgentActivationBootstrap(
      config,
      this.#settings,
      this.#manager,
      this.#oauth,
      () => this.#runtimeContext('post-config').runtimeKind,
      () => this.#release.close(),
      undefined,
      undefined,
      filesystem,
      memory,
      settingsOwner,
      settingsOwnership,
      trust,
      trustCleanup,
      undefined,
      undefined,
      this.#files,
      this.#bus,
      'transferred',
    );
    this.#switch = this.prepareSwitch(
      config,
      () => this.refreshAuth(),
      settingsOwner,
    );
    this.#profiles = this.prepareProfile(
      this.#activation.workspaceDefinitions.profileReads,
      this.#switch,
      settingsOwner,
    );
  }

  private refreshAuth(): Promise<void> {
    if (this.#activation === undefined)
      throw new Error('Post-config preflight is not prepared');
    return this.#activation.sessionClient.refreshAuth();
  }

  private prepareSwitch(
    config: Config,
    refreshAuth: () => Promise<void>,
    owner: SessionSettingsOwner,
  ): ProviderSwitcher {
    this.#assertOpen();
    return assembleProviderSwitch(
      config,
      this.#settings,
      this.#manager,
      this.#oauth,
      () => this.#runtimeContext('post-config').runtimeKind,
      refreshAuth,
      owner,
    );
  }

  private prepareProfile(
    profiles: AgentActivationOperation['workspaceDefinitions']['profileReads'],
    switchProvider: ProviderSwitcher,
    owner: SessionSettingsOwner,
  ): AgentProfileApplication {
    this.#assertOpen();
    return assembleProfileApplication(
      this.#settings,
      this.#manager,
      this.#oauth,
      switchProvider,
      owner,
      profiles,
    );
  }

  dispose(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    const transferred = this.#activationTransferred;
    this.#phase = 'closed';
    this.#closing = Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      const actions: Array<() => void | Promise<void>> = [];
      if (!transferred) {
        const activation = this.#activation;
        if (activation !== undefined) actions.push(() => activation.dispose());
        else {
          actions.push(() => this.#release.close());
          if (this.#ownsSettings)
            actions.push(() => this.#sessionSettings?.dispose());
        }
      }
      for (const close of actions) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, 'Preflight cleanup failed');
    });
    return this.#closing;
  }
}

export function prepareAgentPreflight(
  host: AgentPreflightHostInput,
  authority: CredentialAuthority,
  settings?: SettingsService,
  settingsOwner?: SessionSettingsOwner,
  contributions?: ProviderContributionRegistry,
  oauthSettings?: IOAuthSettingsProvider,
): Promise<AgentProfilePreflight> {
  return AgentProfilePreflight.create(
    host,
    authority,
    settings,
    settingsOwner,
    contributions,
    oauthSettings,
  );
}
