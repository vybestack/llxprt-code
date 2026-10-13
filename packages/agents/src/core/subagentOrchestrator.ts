import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { InteractiveAuthPromptOperation } from '@vybestack/llxprt-code-core/runtime/contracts/InteractiveAuthPrompt.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ApprovalMode } from '@vybestack/llxprt-code-core';

import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

import { activateChildProvider } from './subagent-provider-activation.js';

import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import {
  cleanupAfterFailure,
  runCleanupSteps,
  disposeHistoryLike,
  closeSubagentScope,
} from './subagent-cleanup.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';

import { createSubagentProviderRuntime } from './subagentRuntimeSetup.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { randomUUID } from 'node:crypto';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
} from '@vybestack/llxprt-code-core';
import {
  isLoadBalancerProfile,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import {
  resolveRuntimeProfile,
  type RuntimeProfileResolution,
} from './subagentProfileResolution.js';
import { getStringSetting } from './subagentSettingsAccess.js';
import {
  createSettingsSnapshot,
  normalizeDefaultToolSet,
  populatePostActivationSettings,
  populatePreActivationSettings,
} from './subagentSettingsPopulation.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { SubAgentScope } from './subagent.js';
import type { SubAgentScope as SubAgentScopeInstance } from './subagent.js';
import type {
  ModelConfig,
  PromptConfig,
  RunConfig,
  ToolConfig,
  OutputConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { buildResolvedRunConfig } from './subagent-run-policy.js';
import type { SubagentRunPolicy } from '@vybestack/llxprt-code-core/session/session-settings-policies.js';

import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type {
  AgentRuntimeFactoryBindings,
  RuntimeProviderManager,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

import {
  loadAgentRuntime,
  type AgentRuntimeLoaderOptions,
  type AgentRuntimeLoaderResult,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';

import {
  createIsolatedRuntimeContext,
  createRuntimeActivationBindings,
  type IsolatedRuntimeContextHandle as ProviderIsolatedRuntimeContextHandle,
  type RuntimeActivationBindings,
} from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { admitModelParameters } from '@vybestack/llxprt-code-core/runtime/admit-model-parameters.js';
import { admitLoadBalancerModelParameters } from '../api/admit-load-balancer-model-parameters.js';
import {
  disposeIsolatedMediaRuntime,
  createIsolatedSessionClient,
  closeIsolatedSessionRuntime,
  buildIsolatedAgentConfig,
  prepareIsolatedProviders,
} from '../api/agentRuntimeAssembly.js';

const LOAD_BALANCER_PROVIDER_NAME = 'load-balancer';

type RuntimeLoader = (
  options: AgentRuntimeLoaderOptions,
) => Promise<AgentRuntimeLoaderResult>;

type ScopeFactory = typeof SubAgentScope.create;

const createAbortError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

export const DEFAULT_DISABLED_TOOLS = [] as const;

export interface SubagentLaunchRequest {
  name: string;
  runConfig?: RunConfig;
  behaviourPrompts?: string[];
  toolConfig?: ToolConfig;
  outputConfig?: OutputConfig;
}

export interface SubagentLaunchResult {
  agentId: string;
  scope: SubAgentScope;
  dispose: () => Promise<void>;
  prompt: PromptConfig;
  profile: Profile;
  config: SubagentConfig;
  runtime: AgentRuntimeLoaderResult;
}

export interface SubagentOrchestratorOptions {
  readonly credentialAuthority?: CredentialAuthority;
  readonly requestInteractiveAuth?: InteractiveAuthPromptOperation;
  instructions: InstructionReadOperations;
  toolRegistry?: ToolSelection;
  readMcpInstructions: () => string | undefined;
  workspacePaths: WorkspacePathOperations;
  subagentManager: Pick<
    SubagentDefinitionReads,
    'loadSubagent' | 'listSubagents'
  >;
  profileManager: Pick<ProfileDefinitionReads, 'loadProfile'>;
  foregroundConfig: Config;
  readonly hookOwner?: SessionHookOwner;
  readonly workspaceTrust?: WorkspaceTrustControlPort;
  createChildSettings: () => SettingsService;
  readonly telemetry?: RootTelemetry;
  readRunPolicy: () => SubagentRunPolicy;
  runtimeFactoryBindings?: AgentRuntimeFactoryBindings;
  runtimeActivationBindings?: RuntimeActivationBindings;
  runtimeLoader?: RuntimeLoader;
  scopeFactory?: ScopeFactory;
  idFactory?: () => string;
  /**
   * Required session/runtime MessageBus threaded into the SubAgentScope so
   * non-interactive subagent tool execution can satisfy
   * the child scheduler owner’s explicit MessageBus dependency (Issue #2312).
   */
  messageBus: MessageBus;
}

/**
 * Light-weight orchestrator responsible for resolving subagent configuration,
 * building isolated runtime bundles, and launching {@link SubAgentScope} instances.
 *
 * @plan PLAN-20251029-SUBAGENTORCHESTRATION
 * @requirement REQ-SUBAGENT-ORCH-001, REQ-SUBAGENT-ORCH-002
 */
type IsolatedRuntimeContextHandle = ProviderIsolatedRuntimeContextHandle & {
  readonly mediaOwner: SessionMediaOwner;
  readonly sessionClient: SessionClientOwner;
};

export class SubagentOrchestrator {
  private readonly runtimeLoader: RuntimeLoader;
  private readonly scopeFactory: ScopeFactory;
  private readonly idFactory: () => string;
  private readonly defaultDisabledTools = normalizeDefaultToolSet(
    DEFAULT_DISABLED_TOOLS,
  );

  constructor(private readonly options: SubagentOrchestratorOptions) {
    this.runtimeLoader = options.runtimeLoader ?? loadAgentRuntime;
    this.scopeFactory =
      options.scopeFactory ?? SubAgentScope.create.bind(SubAgentScope);
    this.idFactory = options.idFactory ?? randomUUID;
  }

  private buildScopeDispose(
    scope: SubAgentScope,
    runtimeResult: AgentRuntimeLoaderResult,
    isolatedHandle: IsolatedRuntimeContextHandle,
  ): () => Promise<void> {
    return () =>
      closeSubagentScope(
        () => {
          if (typeof scope.dispose === 'function') scope.dispose();
        },
        runtimeResult.history,
        scope.runtimeContext.history,
        () =>
          closeIsolatedSessionRuntime(
            () => isolatedHandle.cleanup(),
            () => isolatedHandle.config.dispose(),
            () => isolatedHandle.mediaOwner.dispose(),
            () => isolatedHandle.sessionClient.dispose(),
          ),
      );
  }

  private async createScopeWithEnvironment(
    subagent: SubagentConfig,
    promptConfig: PromptConfig,
    modelConfig: ModelConfig,
    runConfig: RunConfig,
    request: SubagentLaunchRequest,
    runtimeResult: AgentRuntimeLoaderResult,
    isolatedHandle: IsolatedRuntimeContextHandle,
    signal?: AbortSignal,
  ): Promise<SubAgentScope> {
    const retry = isolatedHandle.oauthManager.composeRetryOperations(
      runtimeResult.runtimeContext.state.provider,
      {
        profileId:
          isolatedHandle.settingsService.getCurrentProfileName() ?? undefined,
      },
    );
    return this.scopeFactory(
      subagent.name,
      this.options.foregroundConfig,
      promptConfig,
      modelConfig,
      runConfig,
      request.toolConfig,
      request.outputConfig,
      runtimeResult.runtimeContext,
      runtimeResult.contentGenerator,
      runtimeResult.telemetryRoot,
      runtimeResult.toolRegistry,
      runtimeResult.runtimeContext.tools,
      this.options.instructions,
      this.options.workspacePaths,
      this.options.readMcpInstructions,
      this.options.messageBus,
      runtimeResult.settingsSnapshot,
      async (_runtime) =>
        getEnvironmentContext(
          this.options.instructions.snapshot().environmentMemory,
          this.options.workspacePaths.directories(),
        ),
      () =>
        this.options.workspaceTrust?.isTrustedFolder() === true
          ? this.options.foregroundConfig.getApprovalMode()
          : ApprovalMode.DEFAULT,
      () => {
        const providerName = runtimeResult.runtimeContext.state.provider;
        return providerName === LOAD_BALANCER_PROVIDER_NAME
          ? admitLoadBalancerModelParameters(
              isolatedHandle.providerManager.getActiveProvider(),
              isolatedHandle.settingsService,
            )
          : admitModelParameters(
              isolatedHandle.settingsService.getAllGlobalSettings(),
              isolatedHandle.settingsService.getProviderSettings(providerName),
              providerName,
            );
      },
      isolatedHandle.providerFileLifecycle,
      isolatedHandle.sessionClient.hookOperations.execution({
        sessionId: () => runtimeResult.runtimeContext.state.sessionId,
        transcriptPath: () => undefined,
        signal,
      }),
      retry.tryBucketFailover,
      retry.readCurrentBucket,
      signal,
    );
  }

  /**
   * Launches a subagent by name, returning the created {@link SubAgentScope}
   * and associated agent metadata.
   */
  private resolveRunConfig(
    profile: Profile,
    custom: RunConfig | undefined,
  ): RunConfig {
    return buildResolvedRunConfig(
      profile,
      custom,
      this.options.readRunPolicy(),
    );
  }

  async launch(
    request: SubagentLaunchRequest,
    signal?: AbortSignal,
  ): Promise<SubagentLaunchResult> {
    this.throwIfAborted(signal, 'Subagent launch aborted before start.');
    const subagent = await this.loadSubagentConfig(request.name);
    this.throwIfAborted(
      signal,
      'Subagent launch aborted while loading config.',
    );
    const profile = await this.options.profileManager.loadProfile(
      subagent.profile,
    );
    this.throwIfAborted(
      signal,
      'Subagent launch aborted while loading profile.',
    );
    const runtimeProfile = await resolveRuntimeProfile(
      profile,
      this.options.profileManager,
    );
    this.throwIfAborted(
      signal,
      'Subagent launch aborted while resolving runtime profile.',
    );

    const promptConfig = this.buildPromptConfig(
      subagent.systemPrompt,
      request.behaviourPrompts,
    );
    const modelConfig = this.buildModelConfig(
      SubagentOrchestrator.getRuntimeStateProfile(runtimeProfile),
    );
    const runConfig = this.resolveRunConfig(profile, request.runConfig);
    this.throwIfAborted(
      signal,
      'Subagent launch aborted before runtime assembly.',
    );

    const agentRuntimeId = this.createRuntimeId(subagent.name);
    const { runtimeResult, isolatedHandle } = await this.createRuntimeBundle(
      { subagent, runtimeProfile, modelConfig, agentRuntimeId },
      signal,
    );
    let scope: SubAgentScopeInstance | undefined;
    try {
      this.throwIfAborted(
        signal,
        'Subagent launch aborted after runtime assembly completed.',
      );

      scope = await this.createScopeWithEnvironment(
        subagent,
        promptConfig,
        modelConfig,
        runConfig,
        request,
        runtimeResult,
        isolatedHandle,
        signal,
      );
      this.throwIfAborted(signal, 'Subagent launch aborted before completion.');
      const agentId =
        typeof scope.getAgentId === 'function'
          ? scope.getAgentId()
          : `${subagent.name}-${agentRuntimeId}`;

      return {
        agentId,
        scope,
        prompt: promptConfig,
        profile,
        config: subagent,
        runtime: runtimeResult,
        dispose: this.buildScopeDispose(scope, runtimeResult, isolatedHandle),
      };
    } catch (error) {
      return cleanupAfterFailure(error, () =>
        this.cleanupAfterLaunchFailure(scope, runtimeResult, isolatedHandle),
      );
    }
  }

  private async cleanupAfterLaunchFailure(
    scope: SubAgentScopeInstance | undefined,
    runtimeResult: AgentRuntimeLoaderResult,
    isolatedHandle: IsolatedRuntimeContextHandle,
  ): Promise<void> {
    if (scope !== undefined) {
      await this.buildScopeDispose(scope, runtimeResult, isolatedHandle)();
    } else {
      await this.cleanupRuntimeArtifacts(runtimeResult, isolatedHandle);
    }
  }

  private async cleanupRuntimeArtifacts(
    runtimeResult: AgentRuntimeLoaderResult,
    isolatedHandle: IsolatedRuntimeContextHandle,
  ): Promise<void> {
    // Reached when the scope was never created (e.g. scope construction
    // failed) AFTER createIsolatedRuntime already activated the config and
    // ran provider activation — the Config can therefore hold a constructed
    // AgentClient and needs the same children-first dispose.
    await runCleanupSteps([
      () => disposeHistoryLike(runtimeResult.history),
      () =>
        closeIsolatedSessionRuntime(
          () => isolatedHandle.cleanup(),
          () => isolatedHandle.config.dispose(),
          () => isolatedHandle.mediaOwner.dispose(),
          () => isolatedHandle.sessionClient.dispose(),
        ),
    ]);
  }

  private throwIfAborted(signal: AbortSignal | undefined, message: string) {
    if (signal?.aborted === true) {
      throw createAbortError(message);
    }
  }

  private async loadSubagentConfig(name: string): Promise<SubagentConfig> {
    if (!name.trim()) {
      throw new Error('Subagent name is required.');
    }
    try {
      return await this.options.subagentManager.loadSubagent(name);
    } catch (error) {
      if (error instanceof Error) {
        // Check if this is a "subagent not found" error
        if (error.message.includes(`'${name}' not found`)) {
          throw new Error(
            `Unable to load subagent '${name}': Subagent not found. Use the list_subagents tool to discover available subagents before calling the task tool.`,
          );
        }
        throw new Error(`Unable to load subagent '${name}': ${error.message}`);
      }
      throw error;
    }
  }

  private buildPromptConfig(
    basePrompt: string,
    additions?: string[],
  ): PromptConfig {
    const trimmedBase = basePrompt.trim();
    const trimmedAdditions = (additions ?? [])
      .map((part) => part.trim())
      .filter((part): part is string => part.length > 0);

    const promptSections: string[] = [];

    if (trimmedBase) {
      promptSections.push(trimmedBase);
    }

    if (trimmedAdditions.length > 0) {
      const numberedInstructions = trimmedAdditions
        .map((instruction, index) => `(${index + 1}) ${instruction}`)
        .join('\n');
      promptSections.push(
        [
          '--- CURRENT TASK DIRECTIVES ---',
          'Follow these instructions precisely for this run. They take precedence over any default behaviours.',
          numberedInstructions,
        ].join('\n'),
      );
    }

    const merged = promptSections.join('\n\n');

    return {
      systemPrompt: merged,
    };
  }

  private buildModelConfig(profile: Profile): ModelConfig {
    return {
      model: profile.model,
      temp: profile.modelParams.temperature ?? 0.7,
      top_p: profile.modelParams.top_p ?? 1,
    };
  }

  private static getActivationProfile(
    runtimeProfile: RuntimeProfileResolution,
  ): Profile {
    return isLoadBalancerProfile(runtimeProfile.effectiveProfile)
      ? runtimeProfile.effectiveProfile
      : runtimeProfile.primaryProfile;
  }

  private static getRuntimeStateProfile(
    runtimeProfile: RuntimeProfileResolution,
  ): Profile {
    if (!isLoadBalancerProfile(runtimeProfile.effectiveProfile)) {
      return runtimeProfile.primaryProfile;
    }
    // Keep load-balancer profile metadata/settings while stamping runtime
    // provider/model to the registered load-balancer provider identity.
    return {
      ...runtimeProfile.effectiveProfile,
      ephemeralSettings: {
        ...runtimeProfile.effectiveProfile.ephemeralSettings,
      },
      modelParams: { ...runtimeProfile.effectiveProfile.modelParams },
      provider: LOAD_BALANCER_PROVIDER_NAME,
      model: LOAD_BALANCER_PROVIDER_NAME,
    };
  }

  private baseSessionId(): string {
    const { foregroundConfig } = this.options;
    if (typeof foregroundConfig.getSessionId === 'function') {
      const session = foregroundConfig.getSessionId();
      if (session) {
        return String(session);
      }
    }
    return 'llxprt-session';
  }

  private createRuntimeId(subagentName: string): string {
    const suffix = this.idFactory().slice(0, 8);
    return `${this.baseSessionId()}#${subagentName}#${suffix}`;
  }

  private buildContentGeneratorConfig(
    profile: Profile,
    modelConfig: ModelConfig,
  ): ContentGeneratorConfig {
    const authKey = getStringSetting(profile.ephemeralSettings, ['auth-key']);
    const proxy = getStringSetting(profile.ephemeralSettings, [
      'proxy',
      'proxy-url',
    ]);

    return {
      model: modelConfig.model,
      apiKey: authKey,
      proxy,
    };
  }

  private createRuntimeState(
    profile: Profile,
    modelConfig: ModelConfig,
    agentRuntimeId: string,
    subagentName: string,
  ): AgentRuntimeState {
    const sessionId = `${this.baseSessionId()}::${agentRuntimeId}`;
    const baseUrl = getStringSetting(profile.ephemeralSettings, ['base-url']);

    return createAgentRuntimeState({
      runtimeId: agentRuntimeId,
      provider: profile.provider,
      model: modelConfig.model,
      baseUrl,
      proxyUrl: getStringSetting(profile.ephemeralSettings, [
        'proxy',
        'proxy-url',
      ]),
      modelParams: {
        temperature: modelConfig.temp,
        topP: modelConfig.top_p,
        maxTokens: profile.modelParams.max_tokens ?? undefined,
      },
      sessionId,
      // The foreground agent's runtime id. `resolveRuntimeId` defaults a
      // runtime's id to its session id when no explicit id is supplied
      // (see runtimeStateFactory), which is how the foreground runtime is
      // built, so this is that runtime's id and not merely a session key.
      // The orchestrator is reached through the tool framework, which does
      // not carry the caller's runtime context; if that changes, pass the
      // parent runtime id in explicitly rather than re-deriving it here.
      parentRuntimeId: this.baseSessionId(),
      subagentName,
    });
  }

  private async createRuntimeBundle(
    params: {
      subagent: SubagentConfig;
      runtimeProfile: RuntimeProfileResolution;
      modelConfig: ModelConfig;
      agentRuntimeId: string;
    },
    signal?: AbortSignal,
  ): Promise<{
    runtimeResult: AgentRuntimeLoaderResult;
    isolatedHandle: IsolatedRuntimeContextHandle;
  }> {
    const { runtimeProfile, modelConfig, agentRuntimeId, subagent } = params;
    const { effectiveProfile } = runtimeProfile;
    const activationProfile =
      SubagentOrchestrator.getActivationProfile(runtimeProfile);
    const runtimeStateProfile =
      SubagentOrchestrator.getRuntimeStateProfile(runtimeProfile);
    const isLoadBalancerActivation = isLoadBalancerProfile(activationProfile);

    this.throwIfAborted(
      signal,
      'Subagent launch aborted before runtime state.',
    );
    const runtimeState = this.createRuntimeState(
      runtimeStateProfile,
      modelConfig,
      agentRuntimeId,
      subagent.name,
    );
    const settingsService = this.options.createChildSettings();
    if (!isLoadBalancerActivation) {
      populatePreActivationSettings(
        settingsService,
        runtimeStateProfile,
        subagent.profile,
      );
    } else {
      settingsService.setCurrentProfileName(subagent.profile);
      settingsService.set('activeProvider', LOAD_BALANCER_PROVIDER_NAME);
      settingsService.set(
        `providers.${LOAD_BALANCER_PROVIDER_NAME}.model`,
        LOAD_BALANCER_PROVIDER_NAME,
      );
    }

    const isolatedHandle = await this.createIsolatedRuntime(
      settingsService,
      activationProfile,
      runtimeStateProfile,
      subagent.profile,
      subagent.name,
      agentRuntimeId,
      isLoadBalancerActivation,
    );
    try {
      const runtimeResult = await this.loadRuntimeInIsolatedScope({
        subagentName: subagent.name,
        isolatedHandle,
        runtimeState,
        runtimeStateProfile,
        effectiveProfile,
        modelConfig,
        signal,
      });
      return { runtimeResult, isolatedHandle };
    } catch (error) {
      return cleanupAfterFailure(error, () =>
        runCleanupSteps([
          () =>
            closeIsolatedSessionRuntime(
              () => isolatedHandle.cleanup(),
              () => isolatedHandle.config.dispose(),
              () => isolatedHandle.mediaOwner.dispose(),
              () => isolatedHandle.sessionClient.dispose(),
            ),
        ]),
      );
    }
  }

  private async loadRuntimeInIsolatedScope(params: {
    subagentName: string;
    isolatedHandle: IsolatedRuntimeContextHandle;
    runtimeState: AgentRuntimeState;
    runtimeStateProfile: Profile;
    effectiveProfile: Profile;
    modelConfig: ModelConfig;
    signal?: AbortSignal;
  }): Promise<AgentRuntimeLoaderResult> {
    const providerRuntime = createSubagentProviderRuntime(
      params.isolatedHandle.runtimeId,
      params.subagentName,
    );
    const settingsSnapshot = createSettingsSnapshot(
      params.effectiveProfile,
      this.defaultDisabledTools,
    );
    const contentGeneratorConfig = this.buildContentGeneratorConfig(
      params.runtimeStateProfile,
      params.modelConfig,
    );
    const loaderOptions = this.buildRuntimeLoaderOptions({
      isolatedHandle: params.isolatedHandle,
      runtimeState: params.runtimeState,
      settingsSnapshot,
      providerRuntime,
      contentGeneratorConfig,
      signal: params.signal,
    });
    await params.isolatedHandle.tokenizerFactory.prepareTokenizer?.(
      params.runtimeState.provider,
      params.runtimeState.model,
    );
    const loaded = await this.runtimeLoader(loaderOptions);
    loaded.history.setTokenizerFactory({
      getTokenizer: (provider, model) =>
        params.isolatedHandle.tokenizerFactory.getTokenizer(provider, model),
    });
    loaded.history.setActiveTokenizationTarget(
      params.runtimeState.model,
      params.runtimeState.provider,
    );
    return loaded;
  }

  private buildRuntimeLoaderOptions(params: {
    isolatedHandle: IsolatedRuntimeContextHandle;
    runtimeState: AgentRuntimeState;
    settingsSnapshot: ReadonlySettingsSnapshot;
    providerRuntime: ProviderRuntimeContext;
    contentGeneratorConfig: ContentGeneratorConfig;
    signal?: AbortSignal;
  }): AgentRuntimeLoaderOptions {
    const toolRegistry = this.options.toolRegistry;

    return {
      mediaStore: params.isolatedHandle.mediaOwner.store,
      profile: {
        config: params.isolatedHandle.config,
        telemetry: params.isolatedHandle.settingsOwner.telemetry,
        state: params.runtimeState,
        prepareProviderInvocation: (provider, parameters, signal) =>
          params.isolatedHandle.settingsOwner.prepareProviderInvocation(
            params.runtimeState.runtimeId,
            provider,
            parameters,
            signal,
            params.runtimeState.sessionId,
          ),
        readRuntimeSettings: () =>
          params.isolatedHandle.settingsOwner.readRuntimePolicy(),
        readToolGovernance: () =>
          params.isolatedHandle.settingsOwner.readToolGovernance(
            params.isolatedHandle.config.getExcludeTools() ?? [],
          ),
        settings: params.settingsSnapshot,
        providerRuntime: params.providerRuntime,
        promptEstimator: {
          estimatePrompt: (request) =>
            params.isolatedHandle.tokenizerFactory.estimatePrompt(request),
          claimsModel: (model) =>
            params.isolatedHandle.tokenizerFactory.claimsModel?.(model) ??
            false,
          getEstimatorFamily: (model) =>
            params.isolatedHandle.tokenizerFactory.getEstimatorFamily?.(model),
        },
        contentGeneratorConfig: {
          ...params.contentGeneratorConfig,
          contentGeneratorFactory:
            params.isolatedHandle.contentGeneratorFactory,
        },
        toolRegistry,
        providerManager: params.isolatedHandle.providerManager,
      },
      signal: params.signal,
    };
  }

  /**
   * Builds, registers providers onto, activates, and runs provider
   * activation for an isolated runtime so the subagent uses its OWN provider
   * instead of the parent's active provider (Issue #2410).
   */
  private bindChildTools(client: SessionClientOwner): void {
    if (this.options.toolRegistry === undefined)
      throw new Error('Missing explicit child tool selection');
    client.bindInheritedTools(
      this.options.toolRegistry,
      this.options.messageBus,
      this.options.workspaceTrust,
    );
  }

  private async createChildClient(
    config: Config,
    settings: SettingsService,
    settingsOwner: SessionSettingsOwner,
    providerManager: RuntimeProviderManager,
    oauthManager: OAuthManager,
    contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
    tokenizerFactory: RuntimeTokenizerFactory,
    providerFileLifecycle: ProviderFileLifecycle,
    mediaOwner: SessionMediaOwner,
  ): Promise<SessionClientOwner> {
    const client = await createIsolatedSessionClient(
      config,
      settings,
      settingsOwner,
      providerManager,
      oauthManager,
      contentGeneratorFactory,
      tokenizerFactory,
      providerFileLifecycle,
      mediaOwner,
      this.options.runtimeFactoryBindings?.agentClientFactory,
      this.options.readMcpInstructions,
      this.options.workspacePaths,
    );
    client.bindDefinitionReads(
      this.options.profileManager,
      this.options.subagentManager,
    );
    client.bindInheritedInstructions(this.options.instructions);
    client.bindHooks(
      this.options.hookOwner,
      this.options.messageBus,
      this.options.workspaceTrust,
    );
    return client;
  }

  private async createIsolatedRuntime(
    settingsService: SettingsService,
    activationProfile: Profile,
    runtimeStateProfile: Profile,
    profileName: string,
    subagentName: string,
    agentRuntimeId: string,
    isLoadBalancerActivation: boolean,
  ): Promise<IsolatedRuntimeContextHandle> {
    // Do NOT pass the foreground config — the isolated runtime must get its
    // own Config so activation operates on the subagent's provider, not the
    // parent's (Issue #2410). Load-balancer profiles intentionally activate via
    // the foreground profile-application path inside this isolated runtime so
    // the real load-balancer provider is registered and selected.
    const { config: isolatedConfig, mediaOwner } = buildIsolatedAgentConfig({
      sessionId: agentRuntimeId,
      model: activationProfile.model,
      runtimeFactoryBindings: this.options.runtimeFactoryBindings,
      settingsService,
    });
    const handle = createIsolatedRuntimeContext(
      {
        runtimeId: agentRuntimeId,
        credentialAuthority: this.options.credentialAuthority,
        requestInteractiveAuth: this.options.requestInteractiveAuth,
        config: isolatedConfig,
        borrowedTelemetry: this.options.telemetry,
        activationBindings:
          this.options.runtimeActivationBindings ??
          createRuntimeActivationBindings(),
        messageBus: this.options.messageBus,
        metadata: { source: 'SubagentOrchestrator', subagent: subagentName },
        prepare: prepareIsolatedProviders,
      },
      settingsService,
    );

    let sessionClient: SessionClientOwner | undefined;
    try {
      const childClient = await this.createChildClient(
        handle.config,
        handle.settingsService,
        handle.settingsOwner,
        handle.providerManager,
        handle.oauthManager,
        handle.contentGeneratorFactory,
        handle.tokenizerFactory,
        handle.providerFileLifecycle,
        mediaOwner,
      );
      sessionClient = childClient;
      this.bindChildTools(childClient);
      await handle.activate();
      await activateChildProvider(
        handle.config,
        handle.settingsService,
        handle.providerManager,
        handle.oauthManager,
        handle.settingsOwner,
        () => handle.readRuntimeKind(),
        (method) => childClient.refreshAuth(method),
        this.options.profileManager,
        activationProfile,
        profileName,
        isLoadBalancerActivation,
      );
      populatePostActivationSettings(
        settingsService,
        runtimeStateProfile,
        profileName,
        this.defaultDisabledTools,
      );
      return { ...handle, mediaOwner, sessionClient: childClient };
    } catch (error) {
      return cleanupAfterFailure(error, () =>
        disposeIsolatedMediaRuntime(
          () => handle.cleanup(),
          () => handle.config.dispose(),
          () => mediaOwner.dispose(),
          sessionClient?.dispose.bind(sessionClient),
        ),
      );
    }
  }
}
