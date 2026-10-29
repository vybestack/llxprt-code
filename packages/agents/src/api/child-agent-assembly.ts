import type { ChildSessionJournal } from '@vybestack/llxprt-code-core/recording/childJournal.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { openChildSessionJournal } from '../core/subagentChildJournal.js';
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
import {
  type ProviderFileLifecycle,
  type ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  createFileOAuthSettingsProvider,
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
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

import { admitLoadBalancerModelParameters } from './admit-load-balancer-model-parameters.js';
import {
  acquireProviderFiles,
  acquireProviderRuntime,
} from './provider-runtime-acquisition.js';
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
  readonly childSessionId: string;
  readonly parentSessionId: string;
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

interface ChildWorkspace {
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly config: Config;
  readonly media: SessionMediaOwner;
}

interface ChildProvider {
  readonly files: ProviderFileLifecycle;
  readonly manager: ProviderManager;
  readonly tokenizer: RuntimeTokenizerFactory;
  readonly content: RuntimeContentGeneratorFactory<ContentGenerator>;
}

interface ChildAuth {
  readonly oauth: OAuthManager;
}

interface ChildClientOperations {
  readonly refreshAuth: (method?: string) => Promise<void>;
  readonly createHookExecution: SessionHookOwner['execution'];
  readonly dispose: () => Promise<void>;
}

interface ChildProviderStage {
  assemble(fakeResponses: string | undefined): Promise<SubagentLaunchResult>;
}

export class ChildAgentAssembly {
  private readonly providers = new AcquisitionRelease();
  private readonly acquired: Array<() => void | Promise<void>> = [];
  private closing: Promise<void> | undefined;
  private childJournal: ChildSessionJournal | undefined;

  constructor(
    private readonly data: ChildAgentLaunch,
    private readonly acquisition: ChildAgentAcquisition,
    private readonly factories: ChildAgentRuntimeFactories,
    private readonly clientFactory: AgentClientFactory,
    private readonly operations: ChildAgentOperations,
  ) {}

  async assemble(): Promise<SubagentLaunchResult> {
    const fakeResponses = process.env.LLXPRT_FAKE_RESPONSES;
    try {
      this.childJournal = await openChildSessionJournal({
        config: this.acquisition.foregroundConfig,
        workspaceDirs: this.operations.workspacePaths.directories(),
        childSessionId: this.data.childSessionId,
        parentSessionId: this.data.parentSessionId,
        provider: this.data.state.provider,
        model: this.data.model.model,
      });
      const journal = this.childJournal;
      this.acquired.push(() => journal.dispose());
      const workspace = this.acquireWorkspace();
      const providers = this.acquireProviders(workspace);
      return await providers.assemble(fakeResponses);
    } catch (primary) {
      return cleanupAfterFailure(primary, () => this.rollback());
    }
  }

  private acquireWorkspace(): ChildWorkspace {
    const settings = this.acquisition.createChildSettings();
    const profile = this.data.runtimeStateProfile;
    if (isLoadBalancerProfile(this.data.activationProfile)) {
      settings.setCurrentProfileName(this.data.subagent.profile);
      settings.set('activeProvider', 'load-balancer');
      settings.set('providers.load-balancer.model', 'load-balancer');
    } else {
      populatePreActivationSettings(
        settings.set.bind(settings),
        settings.setCurrentProfileName.bind(settings),
        profile,
        this.data.subagent.profile,
      );
    }
    const config = new Config({
      sessionId: this.data.childSessionId,
      targetDir: this.acquisition.foregroundConfig.getTargetDir(),
      debugMode: false,
      cwd: this.acquisition.foregroundConfig.getWorkingDir(),
      proxy: this.acquisition.foregroundConfig.getProxy(),
      model: this.data.activationProfile.model,
      initialSettings: settings.getAllGlobalSettings(),
    });
    const media = new SessionMediaOwner(
      config.projectTempDir,
      config.getMediaStoreQuotaByteLimit(),
    );
    this.acquired.push(() => media.dispose());
    this.acquired.push(() => this.providers.rollback());
    const settingsOwner = new SessionSettingsOwner(settings);
    this.providers.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.bindTelemetry(config, this.operations.telemetry);
    return { settings, config, media, settingsOwner };
  }

  private acquireProviders(workspace: ChildWorkspace): ChildProviderStage {
    const { config, settings, settingsOwner } = workspace;
    const files = acquireProviderFiles(this.providers, {
      proxy: config.getProxy(),
      scopeIds: [this.data.runtimeId, config.getSessionId()],
    });
    const runtimeId = this.data.runtimeId;

    return acquireProviderRuntime(
      this.providers,
      {
        files,
        config,
        proxy: config.getProxy(),
        settings,
        settingsOwner,
        authority: this.acquisition.authority,
        context: createSubagentProviderRuntime(
          this.data.runtimeId,
          this.data.subagent.name,
        ),
      },
      {
        suppliedStore: undefined,
        readSettings: () => createFileOAuthSettingsProvider(),
        messageBus: this.operations.messageBus,
        profileReads: this.operations.profileReads,
        readIdentity: () => ({
          runtimeId,
          runtimeKind: 'agent',
        }),
        requestInteractiveAuth: this.operations.requestInteractiveAuth,
      },
      (manager, oauth) => {
        const tokenizer = configureProviderTokenizer(manager);
        const content = createRuntimeContentGeneratorFactory();
        return {
          assemble: (fakeResponses) =>
            this.assembleAcquired(
              workspace,
              { files, manager, tokenizer, content },
              { oauth },
              fakeResponses,
            ),
        };
      },
    );
  }

  private async assembleAcquired(
    workspace: ChildWorkspace,
    provider: ChildProvider,
    auth: ChildAuth,
    fakeResponses: string | undefined,
  ): Promise<SubagentLaunchResult> {
    const client = await this.prepareClient(workspace, provider, auth);
    await this.activate(
      workspace,
      provider,
      auth,
      client.refreshAuth,
      fakeResponses,
    );
    const loaded = await this.load(workspace, provider);
    this.assertAdmission(
      'Subagent launch aborted after runtime assembly completed.',
    );
    const scope = await this.createScope(
      workspace,
      provider,
      auth,
      client.createHookExecution,
      loaded,
    );
    return this.publishScope(workspace, client.dispose, loaded, scope);
  }

  private async prepareClient(
    workspace: ChildWorkspace,
    provider: ChildProvider,
    auth: ChildAuth,
  ): Promise<ChildClientOperations> {
    const { config, settings, settingsOwner, media } = workspace;
    const { manager, content, tokenizer, files } = provider;
    const { oauth } = auth;
    const client = await acquireSessionClient(
      {
        config,
        messageBus: this.operations.messageBus,
        workspacePaths: this.operations.workspacePaths,
        readInstructions: this.operations.readMcpInstructions,
        imageOperation: undefined,
      },
      { settings, settingsOwner },
      manager,
      oauth,
      {
        contentGeneratorFactory: content,
        tokenizerFactory: tokenizer,
        providerFiles: files,
        mediaStore: media.store,
        authority: this.acquisition.authority,
        clientFactory: this.clientFactory,
      },
    );
    this.acquired.push(() => client.dispose());
    client.clients.bindDefinitionReads(
      this.operations.profileReads,
      this.operations.subagentReads,
    );
    client.clients.bindInheritedInstructions(this.operations.instructions);
    client.bindHooks(
      this.operations.hooks,
      this.operations.messageBus,
      this.operations.trust,
    );
    client.bindInheritedTools(
      this.operations.tools,
      this.operations.messageBus,
      this.operations.trust,
    );
    return {
      refreshAuth: client.clients.refreshAuth.bind(client.clients),
      createHookExecution: client.hookOperations.execution.bind(
        client.hookOperations,
      ),
      dispose: client.dispose.bind(client),
    };
  }

  private async activate(
    workspace: ChildWorkspace,
    provider: ChildProvider,
    auth: ChildAuth,
    refreshAuth: ChildClientOperations['refreshAuth'],
    fakeResponses: string | undefined,
  ): Promise<void> {
    const { config, settings, settingsOwner } = workspace;
    const { manager, tokenizer } = provider;
    const { oauth } = auth;
    await settingsOwner.startTelemetry(config);
    manager.setRetryOperationsFactory((name, profileId) =>
      oauth.composeRetryOperations(name, profileId ? { profileId } : undefined),
    );
    manager.setRuntimeContext(
      createProviderRuntimeContext({
        runtimeId: this.data.runtimeId,
        runtimeKind: 'agent',
        metadata: {
          source: 'SubagentOrchestrator',
          subagent: this.data.subagent.name,
        },
      }),
      settingsOwner,
      settings,
      config,
    );
    registerProvidersOntoManager(
      manager,
      settings,
      config,
      oauth,
      undefined,
      fakeResponses,
    );
    manager.setTokenizerFactory(tokenizer);
    manager.setConfig(config);
    await activateChildProvider(
      config,
      settings,
      manager,
      oauth,
      settingsOwner,
      () => 'agent',
      refreshAuth,
      this.operations.profileReads,
      this.data.activationProfile,
      this.data.subagent.profile,
      isLoadBalancerProfile(this.data.activationProfile),
    );
    populatePostActivationSettings(
      settings.set.bind(settings),
      settings.setCurrentProfileName.bind(settings),
      this.data.runtimeStateProfile,
      this.data.subagent.profile,
      this.data.disabledTools,
    );
  }

  private async load(
    workspace: ChildWorkspace,
    provider: ChildProvider,
  ): Promise<ToolSelectedRuntimeLoaderResult> {
    const { config: workspaceConfig, settingsOwner, media } = workspace;
    const { manager, tokenizer, content } = provider;
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
      workspaceConfig,
      settingsOwner,
      media.store,
      manager,
      tokenizer,
      content,
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
    await tokenizer.prepareTokenizer?.(
      this.data.state.provider,
      this.data.state.model,
    );
    const journal = this.childJournal;
    if (journal === undefined)
      throw new Error('Child journal was not acquired');
    const history = new HistoryService({ recording: journal.recording });
    this.acquired.push(() => disposeHistoryLike(history));
    await history.waitForCommit();
    const loaded = await this.factories.runtimeLoader({
      ...options,
      overrides: { ...options.overrides, historyService: history },
    });
    if (loaded.history !== history)
      this.acquired.push(() => disposeHistoryLike(loaded.history));
    loaded.history.setTokenizerFactory({
      getTokenizer: (provider, model) =>
        tokenizer.getTokenizer(provider, model),
    });
    loaded.history.setActiveTokenizationTarget(
      this.data.state.model,
      this.data.state.provider,
    );
    return loaded;
  }

  private createScope(
    workspace: ChildWorkspace,
    provider: ChildProvider,
    auth: ChildAuth,
    createHookExecution: SessionHookOwner['execution'],
    loaded: ToolSelectedRuntimeLoaderResult,
  ): Promise<ChildAgentScope> {
    const { settings } = workspace;
    const { manager, files } = provider;
    const { oauth } = auth;
    const retry = oauth.composeRetryOperations(
      loaded.runtimeContext.state.provider,
      { profileId: settings.getCurrentProfileName() ?? undefined },
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
        admittedRuntime: loaded.runtimeContext,
        contentGenerator: loaded.contentGenerator,
        telemetry: loaded.telemetryRoot,
        toolRegistry: loaded.toolRegistry,
        toolsView: loaded.runtimeContext.tools,
        settingsSnapshot: loaded.settingsSnapshot,
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
          const provider = loaded.runtimeContext.state.provider;
          return provider === 'load-balancer'
            ? admitLoadBalancerModelParameters(
                manager.getActiveProvider(),
                settings,
              )
            : admitModelParameters(
                settings.getAllGlobalSettings(),
                settings.getProviderSettings(provider),
                provider,
              );
        },
        providerFiles: files,
        hooks: createHookExecution({
          sessionId: () => loaded.runtimeContext.state.sessionId,
          transcriptPath: () => undefined,
          signal: this.data.signal,
        }),
        tryBucketFailover: retry.tryBucketFailover,
        readCurrentBucket: retry.readCurrentBucket,
        dependencies: {},
      },
    );
  }

  private close(
    workspace: ChildWorkspace,
    disposeClient: () => Promise<void>,
    loaded: ToolSelectedRuntimeLoaderResult,
    scope: ChildAgentScope,
  ): Promise<void> {
    const { media } = workspace;
    this.closing ??= runCleanupSteps([
      () => scope.dispose(),
      () => disposeHistoryLike(loaded.history),
      () =>
        disposeIsolatedMediaRuntime(
          () => this.providers.close(),
          () => media.dispose(),
          disposeClient,
        ),
      () => this.childJournal?.dispose(),
    ]);
    return this.closing;
  }
  private publishScope(
    workspace: ChildWorkspace,
    disposeClient: () => Promise<void>,
    loaded: ToolSelectedRuntimeLoaderResult,
    scope: ChildAgentScope,
  ): SubagentLaunchResult {
    this.acquired.push(() => scope.dispose());
    this.assertAdmission('Subagent launch aborted before completion.');
    return {
      agentId: scope.getAgentId(),
      scope,
      prompt: this.data.prompt,
      profile: this.data.profile,
      config: this.data.subagent,
      identity: Object.freeze({
        runtimeId: loaded.runtimeContext.state.runtimeId,
        sessionId: loaded.runtimeContext.state.sessionId,
        provider: loaded.runtimeContext.state.provider,
        model: loaded.runtimeContext.state.model,
      }),
      dispose: () => this.close(workspace, disposeClient, loaded, scope),
    };
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
}
