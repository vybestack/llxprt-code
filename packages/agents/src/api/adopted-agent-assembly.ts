/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  ContentGenerator,
  MessageBus,
  RuntimeContentGeneratorFactory,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { openBrowserSecurely } from '@vybestack/llxprt-code-core';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
  McpClientManager,
} from '@vybestack/llxprt-code-mcp';
import { defaultFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  createFileOAuthSettingsProvider,
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createOAuthProfileReads,
  createRuntimeContentGeneratorFactory,
  createSessionAuthPolicyReader,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderManager } from '@vybestack/llxprt-code-providers';
import { type SettingsService } from '@vybestack/llxprt-code-settings';
import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { cleanupProviderScope } from '../session/session-client-cleanup.js';
import { acquireSessionClient } from '../session/session-client-binding.js';
import { type SessionClientOwner } from '../session/session-client-owner.js';
import {
  acquireProviderFiles,
  acquireRuntimeProviderManager,
  acquireRuntimeOAuth,
} from './provider-runtime-acquisition.js';
import { registerProvidersOntoManager } from './policyComposition.js';
import { type Agent } from './agent.js';
import {
  AgentBootstrapError,
  generateRuntimeId,
  recordOwnership,
  validateAgentRuntimeId,
} from './agentBootstrap.js';
import {
  FromConfigValidatableSchema,
  type AgentAdoptionIntent,
  type AgentSchedulerHandle,
} from './config-types.js';
import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import {
  type FacadeParsedConfig,
  type LeafFacadeValues,
} from './agent-facade.js';
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';
import {
  ForegroundAssembly,
  type ForegroundPreflightSettings,
  type ForegroundPreflightTransfer,
} from './foreground-agent-assembly.js';
import type {
  PreflightAuthInput,
  PreflightProviderInput,
} from './activationPreflightState.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type {
  AdoptedMcpPort,
  McpTeardownPort,
  PublishedMcpPort,
  SessionWorkspaceReadsPort,
} from './mcpRuntimePorts.js';
import { assembleModelSelection } from './model-selection.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import { acquireAdoptedMedia } from './session-image-assembly.js';
import { DEFAULT_SKILL_OPERATIONS } from './workspace-skill-assembly.js';

/** The publication the adopted assembly needs from the operation that owns it. */
export interface AdoptionLifecyclePort {
  validateIdentity(): void;
  publish(agent: Agent): Promise<Agent>;
}

/** The caller-owned values the `fromConfig` path adopts. */
export interface AdoptionSessionInput {
  config: Config;
  settingsService: SettingsService;
  intent: AgentAdoptionIntent;
  credentialAuthority: CredentialAuthority;
}

/**
 * The construction steps the preflight drives on the assembly that finishes the
 * foreground it hands over.
 */
export interface ForegroundAdoptionView {
  assertOpen(): void;
  closeConstructionAdmission(): void;
  acceptPreflightTransfer(
    transfer: ForegroundPreflightTransfer,
    settings: ForegroundPreflightSettings,
    providers: PreflightProviderInput,
    auth: PreflightAuthInput,
  ): void;
  finishForeground(): Promise<Agent>;
}

interface AdoptedProviders {
  readonly settingsOwner: SessionSettingsOwner;
  readonly files: ProviderFileLifecycle;
  readonly manager: ProviderManager;
  readonly oauth: OAuthManager;
  readonly tokenizer: RuntimeTokenizerFactory;
  readonly content: RuntimeContentGeneratorFactory<ContentGenerator>;
}

interface AdoptedSessionStage {
  readonly adoption: AdoptionSessionInput;
  readonly runtimeId: string;
  readonly fakeResponses: string | undefined;
  readonly mcp: AdoptedMcpPort;
  readonly media: SessionMediaOwner | undefined;
  readonly providers: AdoptedProviders;
}

/**
 * Adopts the caller's session. It acquires the adopted owners, hands them to the
 * concrete foreground it holds, and keeps nothing of its own after publication.
 */
export class AdoptedAgentAssembly implements ForegroundAdoptionView {
  readonly #config: Config;
  #adoption: AdoptionSessionInput | undefined;
  #lifecycle: AdoptionLifecyclePort | undefined;
  #foreground: ForegroundAssembly | undefined;
  readonly #release = new AcquisitionRelease();
  readonly #construction = new AbortController();

  private constructor(config: Config) {
    this.#config = config;
  }

  /** The `fromConfig` path: the assembly acquires and publishes the adopted agent. */
  static forAdoption(
    input: AdoptionSessionInput,
    lifecycle: AdoptionLifecyclePort,
  ): AdoptedAgentAssembly {
    const assembly = new AdoptedAgentAssembly(input.config);
    assembly.#adoption = input;
    assembly.#lifecycle = lifecycle;
    return assembly;
  }

  /** The preflight path: the assembly finishes the foreground it is handed. */
  static forPreflight(config: Config): AdoptedAgentAssembly {
    return new AdoptedAgentAssembly(config);
  }

  assertOpen(): void {
    this.#construction.signal.throwIfAborted();
  }

  closeConstructionAdmission(): void {
    this.#construction.abort();
  }

  acceptPreflightTransfer(
    transfer: ForegroundPreflightTransfer,
    settings: ForegroundPreflightSettings,
    providers: PreflightProviderInput,
    auth: PreflightAuthInput,
  ): void {
    this.#foreground = new ForegroundAssembly(
      this.#config,
      transfer,
      settings,
      providers,
      auth,
      this.#construction.signal,
    );
  }

  finishForeground(): Promise<Agent> {
    return this.#requireForeground().finishForeground();
  }

  async assembleAdoption(): Promise<Agent> {
    const fakeResponses = process.env.LLXPRT_FAKE_RESPONSES;
    const adoption = this.#adoption;
    const lifecycle = this.#lifecycle;
    if (adoption === undefined || lifecycle === undefined)
      throw new Error('Adoption construction requires its adoption input');
    try {
      lifecycle.validateIdentity();
      const runtimeId = this.#adoptValidateIntent(adoption.intent);
      const agent = await this.#adoptAdoptConfig(
        adoption,
        runtimeId,
        fakeResponses,
      );
      return await lifecycle.publish(agent);
    } finally {
      this.#adoption = undefined;
      this.#lifecycle = undefined;
    }
  }

  #requireForeground(): ForegroundAssembly {
    const foreground = this.#foreground;
    if (foreground === undefined)
      throw new AgentBootstrapError('Foreground is not acquired');
    return foreground;
  }

  #adoptValidateIntent(intent: AgentAdoptionIntent): string {
    FromConfigValidatableSchema.parse({
      sessionId: intent.sessionId,
      activation: intent.activation,
    });
    const runtimeId = intent.sessionId ?? generateRuntimeId();
    validateAgentRuntimeId(runtimeId);
    return runtimeId;
  }

  #adoptConstructMcp(): Promise<AdoptedMcpPort> {
    const feedback = defaultFeedbackSink;
    return McpRuntimeOwner.create(
      {
        oauth: {
          getAuthProviderFactory: undefined,
          tokenStorage: new MCPOAuthTokenStorage(
            new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
          ),
          openBrowser: openBrowserSecurely,
        },
        config: this.#config,
        managerFactory: McpClientManager,
        extensionLoader: { kind: 'none' },
        policy: { kind: 'none' },
        lsp: { kind: 'none' },
        filesystem: { kind: 'none' },
        filesystemService: { kind: 'none' },
        memory: { kind: 'none' },
        definitions: { kind: 'none' },
        trust: { kind: 'none' },
        ide: { kind: 'none' },
      },
      {
        emitFeedback: feedback,
        skillOperations: {
          kind: 'supplied',
          capability: DEFAULT_SKILL_OPERATIONS,
        },
        mcpSettings: { kind: 'none' },
      },
    );
  }

  async #adoptAdoptConfig(
    adoption: AdoptionSessionInput,
    runtimeId: string,
    fakeResponses: string | undefined,
  ): Promise<Agent> {
    const mcp = await this.#adoptConstructMcp();
    let media: SessionMediaOwner | undefined;
    let providers: AdoptedProviders;
    try {
      media = acquireAdoptedMedia(this.#config);
      providers = this.#adoptAcquireProviders(adoption, runtimeId, mcp);
    } catch (primary) {
      return cleanupFailedAdoption(
        primary,
        () => this.#release.rollback(),
        () => mcp.dispose(),
        media === undefined ? undefined : media.dispose.bind(media),
        undefined,
      );
    }
    return this.#adoptComplete({
      adoption,
      runtimeId,
      fakeResponses,
      mcp,
      media,
      providers,
    });
  }

  #adoptAcquireProviders(
    adoption: AdoptionSessionInput,
    runtimeId: string,
    mcp: Pick<AdoptedMcpPort, 'messageBus'>,
  ): AdoptedProviders {
    const settingsOwner = new SessionSettingsOwner(adoption.settingsService);
    this.#release.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.bindTelemetry(this.#config);
    const config = this.#config;
    const files = acquireProviderFiles(this.#release, {
      proxy: config.getProxy(),
      scopeIds: [runtimeId, config.getSessionId()],
    });
    const manager = acquireRuntimeProviderManager(this.#release, {
      files,
      proxy: config.getProxy(),
      config,
      settings: adoption.settingsService,
      settingsOwner,
      context: adoptionProviderContext(runtimeId),
      authority: adoption.credentialAuthority,
    });
    const oauth = acquireRuntimeOAuth(this.#release, {
      provider: manager,
      readPolicy: createSessionAuthPolicyReader(adoption.settingsService),
      authority: adoption.credentialAuthority,
      oauth: {
