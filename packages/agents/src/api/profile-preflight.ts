/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SessionSettingsOwner,
  type Config,
  type RuntimePolicyOwner,
  type RuntimeProviderManager,
  type WorkspaceTrustControlPort,
  type WorkspaceFilesystemOwner,
  type WorkspaceMemoryOwner,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import {
  ProviderManager,
  type ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import {
  assembleCliProviderRuntime,
  type AssembledCliProviderRuntime,
} from '@vybestack/llxprt-code-providers/runtime/assembleCliProviderRuntime.js';
import { applyCliArgumentOverrides } from '@vybestack/llxprt-code-providers/runtime/settingsResolver.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-providers/runtime/providerSwitch.js';
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
  readonly #authority: CredentialAuthority;
  readonly #contributions: ProviderContributionRegistry | undefined;
  readonly #oauthSettings: IOAuthSettingsProvider | undefined;
  #runtime: AssembledCliProviderRuntime;
  #closed = false;
  #sessionSettings: SessionSettingsOwner | undefined;
  #activation: AgentActivationOperation | undefined;
  #switch: ProviderSwitcher | undefined;
  #profiles: AgentProfileApplication | undefined;
  #ownsSettings = false;
  #activationTransferred = false;

  constructor(
    host: AgentPreflightHostInput,
    authority: CredentialAuthority,
    settings: SettingsService | undefined,
    settingsOwner: SessionSettingsOwner | undefined,
    contributions: ProviderContributionRegistry | undefined,
    oauthSettings: IOAuthSettingsProvider | undefined,
  ) {
    this.#host = captureAgentPreflightHostInput(host);
    this.#settings = settings ?? new SettingsService();
    for (const [key, value] of Object.entries(this.#host.initialSettings ?? {}))
      this.#settings.set(key, value);
    settingsOwner?.assertSettingsIdentity(this.#settings);
    this.#authority = authority;
    this.#contributions = contributions;
    this.#oauthSettings = oauthSettings;
    this.#runtime = assembleCliProviderRuntime({
      credentialAuthority: authority,
      settingsService: this.#settings,
      config: undefined,
      runtimeId: this.#host.runtimeId,
      metadata: this.#host.metadata,
      providerContributions: contributions,
      oauthSettings,
    });
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Agent profile preflight is disposed');
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
    const manager = this.#runtime.providerManager;
    if (!(manager instanceof ProviderManager))
      throw new Error('Profile preflight requires its provider manager owner');
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
      this.#runtime.providerManager.getActiveProvider(),
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
    const previousPolicy = this.#runtime.policyOwner;
    this.#runtime = assembleCliProviderRuntime({
      credentialAuthority: this.#authority,
      settingsService: this.#settings,
      settingsOwner: owner,
      trustPort: trust,
      config,
      runtimeId: this.#host.runtimeId,
      metadata: { ...this.#host.metadata, stage: 'post-config' },
      oauthSettings: this.#oauthSettings,
      providerContributions: this.#contributions,
      registration: this.#runtime.registration,
      oauthManager: this.#runtime.oauthManager,
    });
    await previousPolicy?.dispose();
    if (this.#runtime.policyOwner)
      onPolicyOwnerReady?.(this.#runtime.policyOwner);
    onProviderManagerReady?.(this.#runtime.providerManager);
    onOAuthManagerReady?.(this.#runtime.oauthManager);
    onProviderFilesReady?.(this.#runtime.registration.providerFileLifecycle);
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
      this.#runtime.providerManager,
      this.#runtime.oauthManager ?? null,
      () => this.#runtime.runtime.runtimeKind,
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
      this.#runtime.registration.providerFileLifecycle,
      this.#runtime.runtimeMessageBus,
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
      this.#runtime.providerManager,
      this.#runtime.oauthManager ?? null,
      () => this.#runtime.runtime.runtimeKind,
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
      this.#runtime.providerManager,
      this.#runtime.oauthManager ?? null,
      switchProvider,
      owner,
      profiles,
    );
  }

  async dispose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.finishPostConfiguration();
    if (this.#activation === undefined && this.#ownsSettings)
      await this.#sessionSettings?.dispose();
    await this.#runtime.policyOwner?.dispose();
    this.#runtime.registration.dispose();
  }
}

export function prepareAgentPreflight(
  host: AgentPreflightHostInput,
  authority: CredentialAuthority,
  settings?: SettingsService,
  settingsOwner?: SessionSettingsOwner,
  contributions?: ProviderContributionRegistry,
  oauthSettings?: IOAuthSettingsProvider,
): AgentProfilePreflight {
  return new AgentProfilePreflight(
    host,
    authority,
    settings,
    settingsOwner,
    contributions,
    oauthSettings,
  );
}
