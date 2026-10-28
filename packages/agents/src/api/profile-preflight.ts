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
  type ProviderManager,
  type ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import {
  acquirePreflightResources,
  acquirePreflightProviders,
  type PreflightResources,
  type PreflightProviders,
} from './profile-provider-acquisition.js';
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

import { runCleanupSteps } from '../core/subagent-cleanup.js';

export interface AgentPostConfigSettings {
  writeUserParameter(key: string, value: unknown): void;
  readNamedParameter(key: string): unknown;
  chooseModel(model: string): void;
}

export class AgentProfilePreflight implements AgentPostConfigSettings {
  readonly #host: AgentPreflightHostInput;
  readonly #authority: CredentialAuthority;
  readonly #settings: SettingsService;
  readonly #release: AcquisitionRelease;
  readonly #decisions: PreflightResources['decisions'];
  readonly #bus: PreflightResources['bus'];
  readonly #files: ProviderFileLifecycle;
  readonly #profileReads: PreflightResources['profileReads'];
  readonly #manager: ProviderManager;
  readonly #oauth: OAuthManager;
  #phase: 'pre-config' | 'configured' | 'transferred' | 'closed' = 'pre-config';
  #closing: Promise<void> | undefined;
  #sessionSettings: SessionSettingsOwner | undefined;
  #activation: AgentActivationBootstrap | undefined;
  #provisionalActivation: { dispose(): Promise<void> } | undefined;
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
    resources: PreflightResources,
    providers: PreflightProviders,
  ) {
    this.#host = host;
    this.#authority = authority;
    this.#settings = settings;
    this.#release = resources.release;
    this.#decisions = resources.decisions;
    this.#bus = resources.bus;
    this.#files = resources.files;
    this.#profileReads = resources.profileReads;
    this.#manager = providers.manager;
    this.#oauth = providers.oauth;
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
    const release = new AcquisitionRelease();
    try {
      const resources = acquirePreflightResources(release, captured);
      for (const [key, value] of Object.entries(captured.initialSettings ?? {}))
        settings.set(key, value);
      const providers = acquirePreflightProviders(resources, {
        host: captured,
        settings,
        authority,
        contributions,
        oauthSettings: oauthSettings ?? createFileOAuthSettingsProvider(),
        fakeResponses: process.env.LLXPRT_FAKE_RESPONSES,
      });
      return new AgentProfilePreflight(
        captured,
        settings,
        authority,
        resources,
        providers,
      );
    } catch (error) {
      try {
        await release.rollback();
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

