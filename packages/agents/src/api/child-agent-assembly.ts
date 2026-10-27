import { acquireSessionClient } from '../session/session-client-binding.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ContentGenerator,
  MessageBus,
  ProfileDefinitionReads,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
  SubagentDefinitionReads,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ModelConfig,
  PromptConfig,
  RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import type {
  ToolSelectedRuntimeLoader,
  ToolSelectedRuntimeLoaderResult,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { admitModelParameters } from '@vybestack/llxprt-code-core/runtime/admit-model-parameters.js';
import type { InteractiveAuthPromptOperation } from '@vybestack/llxprt-code-core/runtime/contracts/InteractiveAuthPrompt.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  createFileOAuthSettingsProvider,
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createOwnedTokenStoreClose,
  createOwnerAuthCacheInvalidator,
  createOwnerOAuthManager,
  createRuntimeContentGeneratorFactory,
  createSessionAuthPolicyReader,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { Profile, SettingsService } from '@vybestack/llxprt-code-settings';
import { isLoadBalancerProfile } from '@vybestack/llxprt-code-settings';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import {
  cleanupAfterFailure,
  disposeHistoryLike,
  runCleanupSteps,
} from '../core/subagent-cleanup.js';
import { activateChildProvider } from '../core/subagent-provider-activation.js';
import { buildSubagentRuntimeLoaderOptions } from '../core/subagent-runtime-loader.js';
import type { SubAgentScopeFactory } from '../core/subagent.js';
import type {
  ChildAgentScope,
  SubagentLaunchRequest,
  SubagentLaunchResult,
} from '../core/subagentOrchestrator.js';
import { createSubagentProviderRuntime } from '../core/subagentRuntimeSetup.js';
import { getStringSetting } from '../core/subagentSettingsAccess.js';
import {
  createSettingsSnapshot,
  populatePostActivationSettings,
  populatePreActivationSettings,
} from '../core/subagentSettingsPopulation.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import { admitLoadBalancerModelParameters } from './admit-load-balancer-model-parameters.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import { disposeIsolatedMediaRuntime } from './agentRuntimeAssembly.js';
import { registerProvidersOntoManager } from './policyComposition.js';

export interface ChildAgentLaunch {
  readonly subagent: SubagentConfig;
  readonly activationProfile: Profile;
  readonly runtimeStateProfile: Profile;
  readonly effectiveProfile: Profile;
  readonly profile: Profile;
  readonly model: ModelConfig;
  readonly prompt: PromptConfig;
  readonly run: RunConfig;
  readonly request: SubagentLaunchRequest;
  readonly state: AgentRuntimeState;
  readonly runtimeId: string;
  readonly disabledTools: ReadonlySet<string>;
  readonly signal: AbortSignal;
}

export interface ChildAgentAcquisition {
  readonly authority: CredentialAuthority;
  readonly createChildSettings: () => SettingsService;
  readonly foregroundConfig: Config;
}

export interface ChildAgentRuntimeFactories {
  readonly runtimeLoader: ToolSelectedRuntimeLoader;
  readonly scopeFactory: SubAgentScopeFactory;
}

export interface ChildAgentOperations {
  readonly messageBus: MessageBus;
  readonly requestInteractiveAuth: InteractiveAuthPromptOperation | undefined;
  readonly profileReads: Pick<ProfileDefinitionReads, 'loadProfile'>;
  readonly subagentReads: Pick<
    SubagentDefinitionReads,
    'loadSubagent' | 'listSubagents'
  >;
  readonly telemetry: RootTelemetry;
  readonly instructions: InstructionReadOperations;
  readonly workspacePaths: WorkspacePathOperations;
  readonly readMcpInstructions: () => string | undefined;
  readonly trust: WorkspaceTrustControlPort;
  readonly tools: ToolSelection;
  readonly hooks: SessionHookOwner;
}

export class ChildAgentAssembly {
  private readonly providers = new AcquisitionRelease();
  private readonly acquired: Array<() => void | Promise<void>> = [];
  private settings!: SettingsService;
  private settingsOwner!: SessionSettingsOwner;
  private config!: Config;
  private media!: SessionMediaOwner;
  private files!: ProviderFileLifecycle;
  private manager!: ProviderManager;
  private oauth!: OAuthManager;
  private tokenizer!: RuntimeTokenizerFactory;
  private content!: RuntimeContentGeneratorFactory<ContentGenerator>;
  private client!: SessionClientOwner;
  private loaded!: ToolSelectedRuntimeLoaderResult;
  private scope!: ChildAgentScope;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly data: ChildAgentLaunch,
    private readonly acquisition: ChildAgentAcquisition,
    private readonly factories: ChildAgentRuntimeFactories,
    private readonly clientFactory: AgentClientFactory,
    private readonly operations: ChildAgentOperations,
  ) {}

  async assemble(): Promise<SubagentLaunchResult> {
    try {
      this.acquireWorkspace();
      this.acquireProviders();
      await this.prepareClient();
      await this.activate();
      await this.load();
      this.assertAdmission(
        'Subagent launch aborted after runtime assembly completed.',
      );
      this.scope = await this.createScope();
      this.acquired.push(() => this.scope.dispose());
      this.assertAdmission('Subagent launch aborted before completion.');
      return {
        agentId:
          typeof this.scope.getAgentId === 'function'
            ? this.scope.getAgentId()
            : `${this.data.subagent.name}-${this.data.runtimeId}`,
        scope: this.scope,
        prompt: this.data.prompt,
        profile: this.data.profile,
        config: this.data.subagent,
        identity: Object.freeze({
          runtimeId: this.loaded.runtimeContext.state.runtimeId,
          sessionId: this.loaded.runtimeContext.state.sessionId,
          provider: this.loaded.runtimeContext.state.provider,
          model: this.loaded.runtimeContext.state.model,
        }),
        dispose: () => this.close(),
      };
    } catch (primary) {
      return cleanupAfterFailure(primary, () => this.rollback());
    }
  }

  private acquireWorkspace(): void {
    this.settings = this.acquisition.createChildSettings();
    const profile = this.data.runtimeStateProfile;
    if (isLoadBalancerProfile(this.data.activationProfile)) {
      this.settings.setCurrentProfileName(this.data.subagent.profile);
      this.settings.set('activeProvider', 'load-balancer');
      this.settings.set('providers.load-balancer.model', 'load-balancer');
    } else {
      populatePreActivationSettings(
        this.settings.set.bind(this.settings),
        this.settings.setCurrentProfileName.bind(this.settings),
        profile,
        this.data.subagent.profile,
      );
    }
    this.config = new Config({
      sessionId: this.data.runtimeId,
      targetDir: this.acquisition.foregroundConfig.getTargetDir(),
      debugMode: false,
      cwd: this.acquisition.foregroundConfig.getWorkingDir(),
      proxy: this.acquisition.foregroundConfig.getProxy(),
      model: this.data.activationProfile.model,
      initialSettings: this.settings.getAllGlobalSettings(),
    });
    this.acquired.push(() => this.config.dispose());
    this.media = new SessionMediaOwner(
      this.config.projectTempDir,
      this.config.getMediaStoreQuotaByteLimit(),
    );
    this.acquired.push(() => this.media.dispose());
    this.acquired.push(() => this.providers.rollback());
    this.settingsOwner = new SessionSettingsOwner(this.settings);
    this.providers.acquire('settings', () => this.settingsOwner.dispose());
    this.settingsOwner.bindTelemetry(this.config, this.operations.telemetry);
  }

  private acquireProviders(): void {
    this.files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
      proxy: this.config.getProxy(),
    });
    for (const scope of new Set([
      this.data.runtimeId,
      this.config.getSessionId(),
    ]))
      this.providers.acquire('files', () =>
        releaseAdoptedFileScope(this.files, scope),
      );
    const network = new OwnedFetch(this.config.getProxy());
    this.providers.beforeRelease(() => network.closeAdmissionAndAbort());
    this.providers.acquire('network', () => network.dispose());
    this.manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      this.files,
      this.settings,
      this.config,
      createSubagentProviderRuntime(
        this.data.runtimeId,
        this.data.subagent.name,
      ),
      undefined,
      this.settingsOwner,
    );
    this.manager.bindNetworkFetch(network.fetch);
    this.providers.acquire('manager', () => this.manager.dispose());
    const keys = this.acquisition.authority.createProviderKeyStorage();
    this.providers.acquire('manager', () => keys.close());
    this.manager.bindProviderKeyStorage(keys);
    this.tokenizer = configureProviderTokenizer(this.manager);
    this.content = createRuntimeContentGeneratorFactory();
    const tokens = this.acquisition.authority.createTokenStore();
    this.providers.acquire('tokens', createOwnedTokenStoreClose(tokens));
    this.oauth = createOwnerOAuthManager(
      tokens,
      createFileOAuthSettingsProvider(),
      this.operations.messageBus,
      this.operations.profileReads,
      createSessionAuthPolicyReader(this.settings),
      () => ({ runtimeId: this.data.runtimeId, runtimeKind: 'agent' }),
      this.operations.requestInteractiveAuth,
      createOwnerAuthCacheInvalidator((name) =>
        this.manager.getProviderByName(name),
      ),
      (input, init) => this.manager.fetchNetwork(input, init),
    );
    this.providers.acquire('oauth', () => this.oauth.dispose());
  }

  private async prepareClient(): Promise<void> {
    this.client = await acquireSessionClient(
      {
        config: this.config,
        messageBus: this.operations.messageBus,
        workspacePaths: this.operations.workspacePaths,
        readInstructions: this.operations.readMcpInstructions,
        imageOperation: undefined,
      },
      { settings: this.settings, settingsOwner: this.settingsOwner },
      this.manager,
      this.oauth,
      {
        contentGeneratorFactory: this.content,
        tokenizerFactory: this.tokenizer,
        providerFiles: this.files,
        mediaStore: this.media.store,
        authority: this.acquisition.authority,
        clientFactory: this.clientFactory,
      },
    );
    this.acquired.push(() => this.client.dispose());
    this.client.clients.bindDefinitionReads(
      this.operations.profileReads,
      this.operations.subagentReads,
    );
    this.client.clients.bindInheritedInstructions(this.operations.instructions);
    this.client.bindHooks(
      this.operations.hooks,
      this.operations.messageBus,
      this.operations.trust,
    );
    this.client.bindInheritedTools(
      this.operations.tools,
      this.operations.messageBus,
      this.operations.trust,
    );
  }

  private async activate(): Promise<void> {
    await this.settingsOwner.startTelemetry(this.config);
    this.manager.setRetryOperationsFactory((name, profileId) =>
      this.oauth.composeRetryOperations(
        name,
        profileId ? { profileId } : undefined,
      ),
    );
    this.manager.setRuntimeContext(
      createProviderRuntimeContext({
        runtimeId: this.data.runtimeId,
        runtimeKind: 'agent',
        metadata: {
          source: 'SubagentOrchestrator',
          subagent: this.data.subagent.name,
        },
      }),
      this.settingsOwner,
      this.settings,
      this.config,
    );
    registerProvidersOntoManager(
      this.manager,
      this.settings,
      this.config,
      this.oauth,
      undefined,
    );
    this.manager.setTokenizerFactory(this.tokenizer);
    this.manager.setConfig(this.config);
    await activateChildProvider(
      this.config,
      this.settings,
      this.manager,
      this.oauth,
      this.settingsOwner,
      () => 'agent',
      (method) => this.client.clients.refreshAuth(method),
      this.operations.profileReads,
      this.data.activationProfile,
      this.data.subagent.profile,
      isLoadBalancerProfile(this.data.activationProfile),
    );
    populatePostActivationSettings(
      this.settings.set.bind(this.settings),
      this.settings.setCurrentProfileName.bind(this.settings),
      this.data.runtimeStateProfile,
      this.data.subagent.profile,
      this.data.disabledTools,
    );
  }

  private async load(): Promise<void> {
    const settingsSnapshot = createSettingsSnapshot(
      this.data.effectiveProfile,
      this.data.disabledTools,
    );
    const config = {
      model: this.data.model.model,
      apiKey: getStringSetting(
        this.data.runtimeStateProfile.ephemeralSettings,
        ['auth-key'],
      ),
      proxy: getStringSetting(this.data.runtimeStateProfile.ephemeralSettings, [
        'proxy',
        'proxy-url',
      ]),
    };
    const options = buildSubagentRuntimeLoaderOptions(
      this.config,
      this.settingsOwner,
      this.media.store,
      this.manager,
      this.tokenizer,
      this.content,
      this.operations.tools,
      this.data.state,
      settingsSnapshot,
      createSubagentProviderRuntime(
        this.data.runtimeId,
        this.data.subagent.name,
      ),
      config,
      this.data.signal,
    );
    await this.tokenizer.prepareTokenizer?.(
      this.data.state.provider,
      this.data.state.model,
    );
    this.loaded = await this.factories.runtimeLoader(options);
    this.acquired.push(() => disposeHistoryLike(this.loaded.history));
    this.loaded.history.setTokenizerFactory({
      getTokenizer: (provider, model) =>
        this.tokenizer.getTokenizer(provider, model),
    });
    this.loaded.history.setActiveTokenizationTarget(
      this.data.state.model,
      this.data.state.provider,
    );
  }

  private createScope(): Promise<ChildAgentScope> {
    const retry = this.oauth.composeRetryOperations(
      this.loaded.runtimeContext.state.provider,
      { profileId: this.settings.getCurrentProfileName() ?? undefined },
    );
    return this.factories.scopeFactory(
      {
        name: this.data.subagent.name,
        prompt: this.data.prompt,
        model: this.data.model,
        run: this.data.run,
        toolConfig: this.data.request.toolConfig,
        outputConfig: this.data.request.outputConfig,
        parentSignal: this.data.signal,
      },
      {
        admittedRuntime: this.loaded.runtimeContext,
        contentGenerator: this.loaded.contentGenerator,
        telemetry: this.loaded.telemetryRoot,
        toolRegistry: this.loaded.toolRegistry,
        toolsView: this.loaded.runtimeContext.tools,
        settingsSnapshot: this.loaded.settingsSnapshot,
        foregroundConfig: this.acquisition.foregroundConfig,
      },
      {
        instructions: this.operations.instructions,
        workspacePaths: this.operations.workspacePaths,
        readMcpInstructions: this.operations.readMcpInstructions,
        messageBus: this.operations.messageBus,
        loadEnvironmentContext: async () =>
          getEnvironmentContext(
            this.operations.instructions.snapshot().environmentMemory,
            this.operations.workspacePaths.directories(),
          ),
        readApprovalMode: () =>
          this.operations.trust.isTrustedFolder()
            ? this.acquisition.foregroundConfig.getApprovalMode()
            : ApprovalMode.DEFAULT,
        admitModelParameters: () => {
          const provider = this.loaded.runtimeContext.state.provider;
          return provider === 'load-balancer'
            ? admitLoadBalancerModelParameters(
                this.manager.getActiveProvider(),
                this.settings,
              )
            : admitModelParameters(
                this.settings.getAllGlobalSettings(),
                this.settings.getProviderSettings(provider),
                provider,
              );
        },
        providerFiles: this.files,
        hooks: this.client.hookOperations.execution({
          sessionId: () => this.loaded.runtimeContext.state.sessionId,
          transcriptPath: () => undefined,
          signal: this.data.signal,
        }),
        tryBucketFailover: retry.tryBucketFailover,
        readCurrentBucket: retry.readCurrentBucket,
        dependencies: {},
      },
    );
  }

  private assertAdmission(message: string): void {
    if (this.data.signal.aborted) {
      const error = new Error(message);
      error.name = 'AbortError';
      throw error;
    }
  }

  private rollback(): Promise<void> {
    this.closing ??= runCleanupSteps([...this.acquired].reverse());
    return this.closing;
  }

  private close(): Promise<void> {
    this.closing ??= runCleanupSteps([
      () => this.scope.dispose(),
      () => disposeHistoryLike(this.loaded.history),
      () =>
        disposeIsolatedMediaRuntime(
          () => this.providers.close(),
          () => this.config.dispose(),
          () => this.media.dispose(),
          () => this.client.dispose(),
        ),
    ]);
    return this.closing;
  }
}
