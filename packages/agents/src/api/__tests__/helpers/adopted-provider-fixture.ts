/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentRuntimeFactoryBindings,
  Config,
  MessageBus,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { createOAuthProfileReads } from '@vybestack/llxprt-code-providers/composition.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AgentAdoptionIntent } from '../../config-types.js';
import { AdoptedSessionAssembly } from '../../fromConfig-session.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';

export class AdoptedProviderFixture extends AdoptedSessionAssembly {
  protected adoptSettingsService: SettingsService;
  protected adoptIntent: AgentAdoptionIntent = {};
  protected adoptAgentClient: AgentClientContract | undefined;
  protected adoptRuntimeFactoryBindings:
    | AgentRuntimeFactoryBindings
    | undefined;
  protected adoptPolicyOwner: RuntimePolicyOwner | undefined;
  protected adoptMcpRuntime: McpRuntimeOwner | undefined;
  protected adoptProviderManager: RuntimeProviderManager | undefined;
  protected adoptRelease = new AcquisitionRelease();

  constructor(config: Config, settings: SettingsService, runtimeId: string) {
    super();
    this.config = config;
    this.adoptSettingsService = settings;
    this.adoptRuntimeId = runtimeId;
  }

  acquireManager(
    supplied: RuntimeProviderManager | undefined,
    owner: SessionSettingsOwner,
    files: ProviderFileLifecycle,
    authority: CredentialAuthority,
    release: AcquisitionRelease,
  ): RuntimeProviderManager {
    this.adoptProviderManager = supplied;
    this.adoptSelectedSettings = owner;
    this.adoptFiles = files;
    this.adoptAuthority = authority;
    this.adoptRelease = release;
    this.acquireAdoptedProviderManager();
    return this.adoptManager;
  }

  acquireOAuth(
    supplied: OAuthManager | undefined,
    store: TokenStore | undefined,
    bus: MessageBus,
    manager: RuntimeProviderManager,
    profiles: ReturnType<typeof createOAuthProfileReads> | undefined,
    authority: CredentialAuthority,
    release: AcquisitionRelease,
  ): OAuthManager {
    this.adoptSuppliedOAuth = supplied;
    this.adoptTokenStore = store;
    this.adoptOAuthBus = bus;
    this.adoptManager = manager;
    this.adoptOAuthProfiles = profiles;
    this.adoptAuthority = authority;
    this.adoptRelease = release;
    this.acquireAdoptedOAuth();
    return this.adoptOauth;
  }

  activate(
    owner: SessionSettingsOwner,
    manager: RuntimeProviderManager,
    oauth: OAuthManager,
    populate: boolean,
    tokenizer: RuntimeTokenizerFactory,
  ): Promise<void> {
    this.adoptSelectedSettings = owner;
    this.adoptManager = manager;
    this.adoptOauth = oauth;
    this.adoptProviderManager = populate ? undefined : manager;
    this.adoptTokenizer = tokenizer;
    return this.activateAdoptedProviders();
  }
}
