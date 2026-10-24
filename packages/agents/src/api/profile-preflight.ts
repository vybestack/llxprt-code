import { AgentActivationBootstrap } from './activationPreflightState.js';
import {
  cleanupFailedForegroundWorkspace,
  finishPreflightCleanup,
} from './fromConfig-cleanup.js';
import type {
  AgentClientContract,
  ProfileDefinitionReads,
} from '@vybestack/llxprt-code-core';
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
  WorkspaceFilesystemOwner,
  WorkspaceTrustLifecycle,
  assembleWorkspaceMemory,
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
import { acquireRootNetwork } from './root-network.js';
import { applyCliArgumentOverrides } from './settingsResolver.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import {
  captureAgentPreflightHostInput,
  capturePreflightRuntimeContext,
  type AgentPreflightHostInput,
} from './preflight-host-input.js';
import {
  assembleProfileApplication,
  type AgentProfileApplication,
} from './profileApplicationAssembly.js';
import type {
  AgentActivationOperation,
  ActivationPreflightToken,
} from './activationPreflightState.js';

import type { Agent } from './agent.js';
import type {
  ProviderActivationIntent,
  AgentForegroundHost,
} from './config-types.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';

import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../core/subagent-cleanup.js';

export interface AgentPostConfigSettings {
  writeUserParameter(key: string, value: unknown): void;
  readNamedParameter(key: string): unknown;
  chooseModel(model: string): void;
}

export class AgentProfilePreflight implements AgentPostConfigSettings {
  readonly #host: AgentPreflightHostInput;
  readonly #authority: CredentialAuthority;
  readonly #settings: SettingsService;
  readonly #release = new AcquisitionRelease();
  readonly #decisions = createOwnerPolicyEvaluation();
  readonly #bus = createSessionMessageBus(this.#decisions);
  readonly #files: ProviderFileLifecycle;
  readonly #profileReads = createPreflightOAuthProfileReads();
  #manager!: ProviderManager;
  #oauth!: OAuthManager;
  #phase: 'pre-config' | 'configured' | 'transferred' | 'closed' = 'pre-config';
  #closing: Promise<void> | undefined;
  #sessionSettings: SessionSettingsOwner | undefined;
  #activation: AgentActivationBootstrap | undefined;
  #provisionalActivation: AgentActivationBootstrap | undefined;
  #preparation: Promise<void> | undefined;
  #switch: ProviderSwitcher | undefined;
  #profiles: AgentProfileApplication | undefined;
  #workspaceTrust: WorkspaceTrustControlPort | undefined;
  #readProfiles: ProfileDefinitionReads['listProfiles'] | undefined;
  #runImage: SessionClientOwner['runImageOperation'] | undefined;
  #readHistory:
    | (() => ReturnType<AgentClientContract['getHistory']>)
    | undefined;
  #ownsSettings = false;
  #activationTransferred = false;

  private constructor(
    host: AgentPreflightHostInput,
    settings: SettingsService,
    authority: CredentialAuthority,
  ) {
    this.#host = host;
    this.#authority = authority;
    this.#files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
      proxy: host.proxy,
    });
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
    const operation = new AgentProfilePreflight(captured, settings, authority);
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
    return capturePreflightRuntimeContext(this.#host, stage);
  }

  #acquire(
    authority: CredentialAuthority,
    contributions: ProviderContributionRegistry | undefined,
    oauthSettings: IOAuthSettingsProvider | undefined,
    fakeResponses: string | undefined,
  ): void {
    const network = acquireRootNetwork(this.#release, this.#host.proxy);
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
    manager.bindNetworkFetch(network.fetch);
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

  readDefaultProfileName(): string | null {
    const name = this.#settings.get('defaultProfile');
    return typeof name === 'string' ? name : null;
  }
  logUserPrompt(
    config: Parameters<SessionSettingsOwner['logUserPrompt']>[0],
    event: Parameters<SessionSettingsOwner['logUserPrompt']>[1],
  ): void {
    this.#requireSettings().logUserPrompt(config, event);
  }
  logSlashCommand(
    config: Parameters<SessionSettingsOwner['logSlashCommand']>[0],
    event: Parameters<SessionSettingsOwner['logSlashCommand']>[1],
  ): void {
    this.#requireSettings().logSlashCommand(config, event);
  }
  isTelemetryEnabled(): boolean {
    return this.#requireSettings().isTelemetryEnabled();
  }
  flushTelemetry(): Promise<void> {
    return this.#requireSettings().flushTelemetry();
  }
  readTelemetrySettings(): ReturnType<
    SessionSettingsOwner['readTelemetrySettings']
  > {
    return this.#requireSettings().readTelemetrySettings();
  }
  updateTelemetrySettings(
    update: Parameters<SessionSettingsOwner['updateTelemetrySettings']>[0],
  ): Promise<void> {
    return this.#requireSettings().updateTelemetrySettings(update);
  }
  readConversationLoggingEnabled(): boolean {
    return this.#requireSettings().readConversationLoggingEnabled();
  }
  subscribeModelChanges(
    listener: Parameters<SessionSettingsOwner['subscribeModelChanges']>[0],
  ): () => void {
    return this.#requireSettings().subscribeModelChanges(listener);
  }
  #requireSettings(): SessionSettingsOwner {
    this.#assertOpen();
    const owner = this.#sessionSettings;
    if (owner === undefined)
      throw new Error('Preflight settings have not been prepared');
    return owner;
  }

  readSelectedEndpoint(): unknown {
    return this.#requireSettings().readSelectedEndpoint();
  }
  getActiveProviderName(): string | undefined {
    return this.#manager.getActiveProviderName();
  }
  readonly hasActiveProvider = (): boolean => this.#manager.hasActiveProvider();
  setActiveProvider(
    provider: string,
  ): ReturnType<RuntimeProviderManager['setActiveProvider']> {
    this.#assertOpen();
    return this.#manager.setActiveProvider(provider);
  }
  getCurrentProfileName(): string | null {
    return this.#settings.getCurrentProfileName();
  }
  forkSandboxPreflight(): Promise<AgentProfilePreflight> {
    this.#assertOpen();
    return AgentProfilePreflight.create(
      this.#host,
      this.#authority,
      this.#settings,
      undefined,
      undefined,
      undefined,
    );
  }
  captureSettingsSnapshot(): ReturnType<
    SettingsService['exportForStateSnapshot']
  > {
    return this.#settings.exportForStateSnapshot();
  }
  load(name: string): ReturnType<AgentProfileApplication['load']> {
    if (this.#profiles === undefined)
      throw new Error('Post-config preflight is not prepared');
    return this.#profiles.load(name);
  }
  applySnapshot(
    ...args: Parameters<AgentProfileApplication['applySnapshot']>
  ): ReturnType<AgentProfileApplication['applySnapshot']> {
    if (this.#profiles === undefined)
      throw new Error('Post-config preflight is not prepared');
    return this.#profiles.applySnapshot(...args);
  }
  isApplying(): boolean {
    return this.#profiles?.isApplying() ?? false;
  }
  cancelAndJoin(): Promise<void> {
    return this.#profiles?.cancelAndJoin() ?? Promise.resolve();
  }
  listProfiles(): ReturnType<ProfileDefinitionReads['listProfiles']> {
    this.#assertOpen();
    const read = this.#readProfiles;
    if (read === undefined)
      throw new Error('Post-config preflight is not prepared');
    return read();
  }
  runImageOperation(
    ...args: Parameters<SessionClientOwner['runImageOperation']>
  ): ReturnType<SessionClientOwner['runImageOperation']> {
    this.#assertOpen();
    const run = this.#runImage;
    if (run === undefined)
      throw new Error('Post-config preflight is not prepared');
    return run(...args);
  }
  captureHistory(): ReturnType<AgentClientContract['getHistory']> {
    this.#assertOpen();
    const read = this.#readHistory;
    if (read === undefined)
      throw new Error('Post-config preflight is not prepared');
    return read();
  }
  isTrustedFolder(): boolean {
    return this.#requireTrust().isTrustedFolder();
  }
  getIdeTrust(): boolean | undefined {
    return this.#requireTrust().getIdeTrust();
  }
  setTrustedFolderLive(trusted: boolean): Promise<void> {
    return this.#requireTrust().setTrustedFolderLive(trusted);
  }
  setIdeTrustLive(trusted: boolean | undefined): Promise<void> {
    return this.#requireTrust().setIdeTrustLive(trusted);
  }
  whenSettled(): Promise<void> {
    return this.#requireTrust().whenSettled();
  }
  subscribeTrustTransition(
    listener: Parameters<
      WorkspaceTrustControlPort['subscribeTrustTransition']
    >[0],
  ): () => void {
    return this.#requireTrust().subscribeTrustTransition(listener);
  }
  subscribeTrustRevocation(
    listener: Parameters<
      WorkspaceTrustControlPort['subscribeTrustRevocation']
    >[0],
  ): () => void {
    return this.#requireTrust().subscribeTrustRevocation(listener);
  }
  subscribeTrustChange(
    listener: Parameters<WorkspaceTrustControlPort['subscribeTrustChange']>[0],
  ): () => void {
    return this.#requireTrust().subscribeTrustChange(listener);
  }
  bindMcpSettings(
    ...args: Parameters<SessionSettingsOwner['bindMcpSettings']>
  ): void {
    this.#requireSettings().bindMcpSettings(...args);
  }
  #requireTrust(): WorkspaceTrustControlPort {
    this.#assertOpen();
    const trust = this.#workspaceTrust;
    if (trust === undefined)
      throw new Error('Post-config preflight is not prepared');
    return trust;
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
  ): Promise<RuntimePolicyOwner> {
    this.#assertOpen();
    owner.assertSettingsIdentity(this.#settings);
    const policy = new RuntimePolicyOwner(config, trust, undefined, this.#bus);
    this.#configuredData = config;
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
    return policy;
  }

  async prepareConfiguredWorkspace(
    config: Config,
    beforePreparation: () => void,
    suppliedSettings?: SessionSettingsOwner,
  ): Promise<void> {
    return this.#acceptPreparation(async () => {
      this.#assertOpen();
      if (this.#sessionSettings !== undefined)
        throw new Error('Post-config preflight is already prepared');
      const trust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      const filesystem = new WorkspaceFilesystemOwner({
        targetDir: config.getTargetDir(),
        includeDirectories: config.getConfiguredIncludeDirectories(),
        isTrusted: () => trust.isTrustedFolder(),
      });
      const memory = assembleWorkspaceMemory(config, filesystem, trust);
      try {
        await memory.operations.refresh();
        this.#assertOpen();
        beforePreparation();
        await this.#preparePostConfiguration(
          config,
          filesystem,
          memory,
          trust,
          () => trust.dispose(),
          suppliedSettings,
        );
      } catch (error) {
        await cleanupFailedForegroundWorkspace(
          error,
          () => memory.dispose(),
          () => filesystem.dispose(),
          () => trust.dispose(),
        );
      }
    });
  }

  #acceptPreparation(operation: () => Promise<void>): Promise<void> {
    this.#assertOpen();
    if (this.#preparation !== undefined)
      throw new Error('Post-config preflight is already prepared');
    const acquisition = Promise.resolve().then(operation);
    this.#preparation = acquisition;
    return acquisition.catch(async (error: unknown) => {
      try {
        await this.dispose();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Post-config preflight cleanup failed',
        );
      }
      throw error;
    });
  }

  async preparePostConfiguration(
    config: Config,
    filesystem: WorkspaceFilesystemOwner,
    memory: WorkspaceMemoryOwner,
    trust: WorkspaceTrustControlPort,
    trustCleanup: (() => Promise<void>) | undefined,
    suppliedSettings?: SessionSettingsOwner,
  ): Promise<void> {
    return this.#acceptPreparation(() =>
      this.#preparePostConfiguration(
        config,
        filesystem,
        memory,
        trust,
        trustCleanup,
        suppliedSettings,
      ),
    );
  }

  async #preparePostConfiguration(
    config: Config,
    filesystem: WorkspaceFilesystemOwner,
    memory: WorkspaceMemoryOwner,
    trust: WorkspaceTrustControlPort,
    trustCleanup: (() => Promise<void>) | undefined,
    suppliedSettings?: SessionSettingsOwner,
  ): Promise<void> {
    this.#assertOpen();
    if (this.#sessionSettings !== undefined)
      throw new Error('Post-config preflight is already prepared');
    this.#ownsSettings = suppliedSettings === undefined;
    this.#sessionSettings =
      suppliedSettings ?? new SessionSettingsOwner(this.#settings);
    const policy = await this.bindConfig(config, trust, this.#sessionSettings);
    await this.#prepareActivation(
      config,
      filesystem,
      memory,
      trust,
      trustCleanup,
      policy,
    );
    this.#assertOpen();
    this.#phase = 'configured';
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
    if (!this.#activationTransferred && this.#activation !== undefined)
      await this.#activation.dispose();
  }

  async #prepareActivation(
    config: Config,
    filesystem: WorkspaceFilesystemOwner,
    memory: WorkspaceMemoryOwner,
    trust: WorkspaceTrustControlPort,
    trustCleanup: (() => Promise<void>) | undefined,
    policy: RuntimePolicyOwner,
  ): Promise<void> {
    this.#assertOpen();
    const settingsOwner = this.#requireSettings();
    class PreparedActivation extends AgentActivationBootstrap {
      constructor(preflight: AgentProfilePreflight) {
        super(config);
        this.activationSettings = preflight.#settings;
        this.activationManager = preflight.#manager;
        this.activationOAuth = preflight.#oauth;
        this.activationReadKind = () =>
          preflight.#runtimeContext('post-config').runtimeKind;
        this.activationProviderLifetime = () => preflight.#release.close();
        this.activationFilesystem = filesystem;
        this.activationMemory = memory;
        this.activationSettingsOwner = settingsOwner;
        this.activationSettingsOwnership = preflight.#ownsSettings
          ? 'transferred'
          : 'borrowed';
        this.activationTrust = trust;
        this.activationTrustCleanup = trustCleanup;
        this.activationFiles = preflight.#files;
        this.activationBus = preflight.#bus;
        this.activationMemoryOwnership = 'transferred';
        this.foregroundPolicy = policy;
        this.foregroundSettings = preflight.#settings;
        this.foregroundManager = preflight.#manager;
        this.foregroundOAuth = preflight.#oauth;
        this.foregroundAuthority = preflight.#authority;
        this.foregroundRuntimeContext = {
          ...preflight.#runtimeContext('post-config'),
          runtimeKind: 'agent',
        };
        this.releaseForegroundProviders = () =>
          preflight.#releaseForegroundProviders();
      }
      async prepare(): Promise<ProviderSwitcher> {
        await this.acquireActivation();
        try {
          this.initializePreparedActivation();
        } catch (error) {
          return cleanupAfterFailure(error, () => this.dispose());
        }
        return this.activationSwitch;
      }
    }
    const activation = new PreparedActivation(this);
    this.#provisionalActivation = activation;
    const switching = await activation.prepare().catch((error: unknown) => {
      this.#provisionalActivation = undefined;
      throw error;
    });
    this.#assertOpen();
    this.#switch = switching;
    this.#activation = activation;
    this.#workspaceTrust = trust;
    this.#readProfiles = () => activation.listProfiles();
    this.#runImage = activation.sessionClient.runImageOperation.bind(
      activation.sessionClient,
    );
    this.#readHistory = () => activation.readHistory();
    this.#profiles = assembleProfileApplication(
      this.#settings,
      this.#manager,
      this.#oauth,
      this.#switch,
      settingsOwner,
      { loadProfile: (name) => activation.loadProfile(name) },
      (_result, signal) => {
        this.#assertOpen();
        return activation.prepareProfileActivation(signal);
      },
    );
  }

  #configuredData: Config | undefined;
  #foregroundPending: Promise<Agent> | undefined;
  #foregroundTransferred = false;

  static async createForegroundAgent(
    preflight: AgentProfilePreflight,
    token: ActivationPreflightToken,
    intent: ProviderActivationIntent,
    host: AgentForegroundHost,
  ): Promise<Agent> {
    preflight.#assertOpen();
    if (preflight.#foregroundPending !== undefined)
      throw new Error('Foreground construction was already accepted');
    const operation = preflight.#activation;
    const config = preflight.#configuredData;
    if (operation === undefined || config === undefined)
      throw new Error('Foreground construction requires configured preflight');
    if (preflight.#sessionSettings === undefined)
      throw new Error('Missing configured settings owner');
    preflight.#foregroundPending = operation.createForeground(
      token,
      intent,
      host,
    );
    preflight.#activationTransferred = true;
    await preflight.#foregroundPending;
    if (preflight.#phase !== 'closed') preflight.#foregroundTransferred = true;
    return preflight.#foregroundPending;
  }

  async #releaseForegroundProviders(): Promise<void> {
    await runCleanupSteps([
      () => this.#release.close(),
      () => (this.#ownsSettings ? this.#sessionSettings?.dispose() : undefined),
    ]);
  }

  dispose(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    if (!this.#foregroundTransferred)
      this.#activation?.closeForegroundAdmission();
    const transferred = this.#activationTransferred;
    this.#phase = 'closed';
    this.#closing = Promise.resolve().then(async () => {
      await Promise.allSettled([this.#preparation]);
      const actions: Array<() => void | Promise<void>> = [];
      if (
        this.#foregroundPending !== undefined &&
        !this.#foregroundTransferred
      ) {
        await this.#foregroundPending.catch(() => undefined);
        const foreground = this.#activation;
        if (foreground !== undefined)
          actions.push(() => foreground.disposeForeground());
      } else if (!transferred) {
        const activation = this.#activation ?? this.#provisionalActivation;
        if (activation !== undefined) actions.push(() => activation.dispose());
        actions.push(() => this.#release.close());
        if (this.#ownsSettings)
          actions.push(() => this.#sessionSettings?.dispose());
      }
      await finishPreflightCleanup(actions);
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
