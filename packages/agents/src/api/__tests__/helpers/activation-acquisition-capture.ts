/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spyOn } from 'bun:test';
import type {
  Config,
  RuntimeProviderManager,
  MessageBus,
  WorkspaceDefinitionOwner,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import { AgentActivationBootstrap } from '../../activationPreflightState.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import type {
  ProviderActivationIntent,
  AgentForegroundHost,
} from '../../config-types.js';
import type { ProviderActivationResult } from '../../providerActivationExecutor.js';
import type { ActivationPreflightToken } from '../../activation-types.js';
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import { createCapturedSessionOwner } from './session-client-capture.js';

class ActivationFixture extends AgentActivationBootstrap {
  private customExecute:
    | ((intent: ProviderActivationIntent) => Promise<ProviderActivationResult>)
    | undefined;
  constructor(config?: Config) {
    super(config);
  }
  capturePreparedState() {
    return {
      config: this.config,
      settingsService: this.activationSettings,
      manager: this.activationManager,
      providerFileLifecycle: this.providerFileLifecycle,
      media: this.mediaOwner,
      owner: this.ownedSessionClient,
      workspaceFilesystem: this.workspaceFilesystem,
      workspaceMemory: this.workspaceMemory,
      ownsFilesystem: this.ownsFilesystem,
      settings: this.settingsOwner,
      settingsOwnerOwnership: this.settingsOwnerOwnership,
      workspaceDefinitions: this.workspaceDefinitions,
      ownsDefinitions: this.ownsDefinitions,
      workspaceTrust: this.workspaceTrust,
      trustCleanup: this.trustCleanup,
      oauthManager: this.oauthManager,
      messageBus: this.messageBus,
      workspaceMemoryOwnership: this.workspaceMemoryOwnership,
    };
  }
  protected override executeActivation(intent: ProviderActivationIntent) {
    return this.customExecute === undefined
      ? super.executeActivation(intent)
      : this.customExecute(intent);
  }
  configureForeground(
    settings: SettingsService,
    manager: RuntimeProviderManager,
    oauth: OAuthManager,
    policy: RuntimePolicyOwner | undefined,
    authority: CredentialAuthority,
    releaseProviders: () => Promise<void>,
    runtimeContext: Parameters<RuntimeProviderManager['setRuntimeContext']>[0],
  ): void {
    this.foregroundSettings = settings;
    this.foregroundManager = manager;
    this.foregroundOAuth = oauth;
    this.foregroundPolicy = policy;
    this.foregroundAuthority = authority;
    this.releaseForegroundProviders = releaseProviders;
    this.foregroundRuntimeContext = runtimeContext;
  }
  static async acquire(
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
    messageBus?: Parameters<typeof SessionClientOwner.create>[11],
    memoryOwnership: 'borrowed' | 'transferred' = 'borrowed',
  ): Promise<ActivationFixture> {
    const operation = new ActivationFixture(config);
    operation.activationSettings = settings;
    operation.activationManager = manager;
    operation.activationOAuth = oauth;
    operation.activationReadKind = readKind;
    operation.activationProviderLifetime = providerLifetime;
    operation.activationSuppliedClient = agentClient;
    operation.activationMcp = mcpRuntime;
    operation.activationFilesystem = filesystemOwner;
    operation.activationMemory = memoryOwner;
    operation.activationSettingsOwner = suppliedSettingsOwner;
    operation.activationSettingsOwnership = settingsOwnerOwnership;
    operation.activationTrust = suppliedTrust;
    operation.activationTrustCleanup = trustCleanup;
    operation.activationTokenizer = tokenizerFactory;
    operation.activationContent = contentGeneratorFactory;
    operation.activationFiles = providerFileLifecycle;
    operation.activationBus = messageBus;
    operation.activationMemoryOwnership = memoryOwnership;
    await operation.acquireActivation();
    operation.initializePreparedActivation();
    acquisitions.set(operation, operation.capturePreparedState());
    return operation;
  }
  static prepared(
    config: Config,
    manager: RuntimeProviderManager | undefined,
    execute: (
      intent: ProviderActivationIntent,
    ) => Promise<ProviderActivationResult>,
    providerFileLifecycle: ProviderFileLifecycle | undefined,
    mediaOwner: SessionMediaOwner | undefined,
    ownedSessionClient: SessionClientOwner,
    workspaceFilesystem: WorkspaceFilesystemOwner,
    workspaceMemory: WorkspaceMemoryOwner,
    ownsFilesystem: boolean,
    settingsOwner: SessionSettingsOwner,
    settingsOwnerOwnership: 'borrowed' | 'transferred' = 'transferred',
    workspaceDefinitions: WorkspaceDefinitionOwner,
    ownsDefinitions: boolean,
    workspaceTrust: WorkspaceTrustControlPort,
    trustCleanup: (() => Promise<void>) | undefined = undefined,
    oauthManager?: OAuthManager,
    messageBus?: MessageBus,
    workspaceMemoryOwnership: 'borrowed' | 'transferred' = ownsFilesystem
      ? 'transferred'
      : 'borrowed',
  ): ActivationFixture {
    if (manager === undefined)
      throw new Error('Fixture requires a provider manager');
    const operation = new ActivationFixture(config);
    operation.providerFileLifecycle = providerFileLifecycle;
    operation.ownedSessionClient = ownedSessionClient;
    operation.workspaceFilesystem = workspaceFilesystem;
    operation.workspaceMemory = workspaceMemory;
    operation.ownsFilesystem = ownsFilesystem;
    operation.settingsOwner = settingsOwner;
    operation.settingsOwnerOwnership = settingsOwnerOwnership;
    operation.workspaceDefinitions = workspaceDefinitions;
    operation.ownsDefinitions = ownsDefinitions;
    operation.workspaceTrust = workspaceTrust;
    operation.trustCleanup = trustCleanup;
    operation.oauthManager = oauthManager;
    operation.messageBus = messageBus;
    operation.workspaceMemoryOwnership = workspaceMemoryOwnership;
    operation.mediaOwner = mediaOwner;
    operation.activationManager = manager;
    operation.customExecute = execute;
    operation.initializePreparedActivation();
    acquisitions.set(operation, operation.capturePreparedState());
    return operation;
  }
}
const acquisitions = new WeakMap<
  object,
  ReturnType<ActivationFixture['capturePreparedState']>
>();
function defaultSettingsOwnership(
  owner: SessionSettingsOwner | undefined,
): 'borrowed' | 'transferred' {
  return owner === undefined ? 'transferred' : 'borrowed';
}
export function capturedActivation(operation: object) {
  const captured = acquisitions.get(operation);
  if (captured === undefined)
    throw new Error('Activation has no actual acquisition capture');
  return captured;
}
export function captureActivationAcquisition(
  ...args: Parameters<typeof ActivationFixture.acquire>
): Promise<ActivationFixture> {
  return captureActivationConstruction(() =>
    ActivationFixture.acquire(...args),
  );
}
export function prepareActivationFixture(
  ...args: Parameters<typeof ActivationFixture.prepared>
): AgentActivationBootstrap {
  return ActivationFixture.prepared(...args);
}
export function createFixtureForeground(
  operation: AgentActivationBootstrap,
  token: ActivationPreflightToken,
  intent: ProviderActivationIntent,
  host: AgentForegroundHost,
  ...args: Parameters<ActivationFixture['configureForeground']>
) {
  if (!(operation instanceof ActivationFixture))
    throw new Error('Expected an actual fixture activation owner');
  operation.configureForeground(...args);
  return operation.createForeground(token, intent, host);
}
function isInitialization(
  value: unknown,
): value is (this: AgentActivationBootstrap) => void {
  return typeof value === 'function';
}
export function observeActivationPreparation(
  observed: (
    operation: AgentActivationBootstrap,
    state: ReturnType<ActivationFixture['capturePreparedState']>,
  ) => void,
): { mockRestore(): void } {
  const original = Object.getOwnPropertyDescriptor(
    AgentActivationBootstrap.prototype,
    'initializePreparedActivation',
  );
  const initialize: unknown = original?.value;
  if (original === undefined || !isInitialization(initialize))
    throw new Error('Missing actual activation initialization');
  Object.defineProperty(
    AgentActivationBootstrap.prototype,
    'initializePreparedActivation',
    {
      ...original,
      value(this: AgentActivationBootstrap): void {
        initialize.call(this);
        const state =
          ActivationFixture.prototype.capturePreparedState.call(this);
        acquisitions.set(this, state);
        observed(this, state);
      },
    },
  );
  const clients = spyOn(SessionClientOwner, 'create').mockImplementation(
    createCapturedSessionOwner,
  );
  return {
    mockRestore: () => {
      clients.mockRestore();
      Object.defineProperty(
        AgentActivationBootstrap.prototype,
        'initializePreparedActivation',
        original,
      );
    },
  };
}
export async function captureActivationConstruction<T>(
  build: () => Promise<T>,
): Promise<T> {
  const capture = observeActivationPreparation(() => {});
  try {
    return await build();
  } finally {
    capture.mockRestore();
  }
}
