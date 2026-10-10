import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ApprovalMode } from '@vybestack/llxprt-code-core';

import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

import { assembleModelSelection } from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';

import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import {
  cleanupAfterFailure,
  runCleanupSteps,
  disposeHistoryLike,
  firstDefinedHistory,
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
  buildActivationCliOverrides,
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
import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';
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
import { admitModelParameters } from '@vybestack/llxprt-code-providers/runtime/admitModelParameters.js';
import { admitLoadBalancerModelParameters } from '@vybestack/llxprt-code-providers/runtime/admitLoadBalancerModelParameters.js';
import { assembleProfileApplication } from '../api/profileApplicationAssembly.js';
import { assembleSessionProviderSwitch } from '../api/providerSwitchAssembly.js';
import { executeProviderActivation } from '../api/providerActivationExecutor.js';
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
    return async () => {
      const history = firstDefinedHistory(
        runtimeResult.history,
        scope.runtimeContext.history,
      );
      await runCleanupSteps([
        () => {
          if (typeof scope.dispose === 'function') {
            scope.dispose();
          }
        },
        () => disposeHistoryLike(history),
        () => closeIsolatedSessionRuntime(isolatedHandle),
      ]);
    };
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
    return this.scopeFactory(
      subagent.name,
      this.options.foregroundConfig,
      promptConfig,
      modelConfig,
      runConfig,
      request.toolConfig,
      request.outputConfig,
      {
        runtimeBundle: runtimeResult,
        readApprovalMode: () =>
          this.options.workspaceTrust?.isTrustedFolder() === true
            ? this.options.foregroundConfig.getApprovalMode()
            : ApprovalMode.DEFAULT,
        hookOwner: isolatedHandle.sessionClient.hookOperations.execution({
          sessionId: () => runtimeResult.runtimeContext.state.sessionId,
          transcriptPath: () => undefined,
          signal,
        }),
        workspacePaths: this.options.workspacePaths,
        instructions: this.options.instructions,
        readMcpInstructions: this.options.readMcpInstructions,
        environmentContextLoader: async (_runtime) =>
          getEnvironmentContext(
            this.options.instructions.snapshot().environmentMemory,
            this.options.workspacePaths.directories(),
          ),
        messageBus: this.options.messageBus,
        admitModelParameters: () => {
          const providerName = runtimeResult.runtimeContext.state.provider;
          return providerName === LOAD_BALANCER_PROVIDER_NAME
            ? admitLoadBalancerModelParameters(
                isolatedHandle.providerManager.getActiveProvider(),
                isolatedHandle.settingsService,
              )
            : admitModelParameters(
                isolatedHandle.settingsService,
                providerName,
              );
        },
      },
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
      () => closeIsolatedSessionRuntime(isolatedHandle),
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
        runCleanupSteps([() => closeIsolatedSessionRuntime(isolatedHandle)]),
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
      params.isolatedHandle,
      params.effectiveProfile.provider,
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
    handle: Parameters<typeof createIsolatedSessionClient>[0],
    mediaOwner: SessionMediaOwner,
  ): Promise<SessionClientOwner> {
    const client = await createIsolatedSessionClient(
      handle,
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
      const ownedSessionClient = await this.createChildClient(
        handle,
        mediaOwner,
      );
      sessionClient = ownedSessionClient;
      this.bindChildTools(ownedSessionClient);
      await handle.activate();
      const switchProvider = assembleSessionProviderSwitch(handle, () =>
        ownedSessionClient.refreshAuth(),
      );

      if (isLoadBalancerActivation) {
        await assembleProfileApplication(
          handle.config,
          handle.settingsService,
          handle.providerManager,
          handle.oauthManager,
          switchProvider,
          handle.settingsOwner,
          this.options.profileManager,
        ).applySnapshot(activationProfile, { profileName });
      } else {
        await executeProviderActivation(
          handle.config,
          {
            provider: activationProfile.provider,
            model: activationProfile.model,
            modelParams: activationProfile.modelParams,
            // Carry the profile's credential/endpoint ephemerals into the
            // activation so the isolated provider talks to the RIGHT endpoint
            // with the RIGHT key. Without base-url, a profile like zai
            // (provider 'anthropic', base-url https://api.z.ai/api/anthropic)
            // would fall back to the provider default (api.anthropic.com) and
            // its z.ai key would never authenticate — the request stalls until
            // the 5-minute first-response timeout and the subagent returns an
            // empty result. auth-key-name/auth-keyfile are resolved the same
            // way the CLI bootstrap applies them (Issue #2410).
            cliOverrides: buildActivationCliOverrides(activationProfile),
          },
          switchProvider,
          handle.settingsService,
          handle.providerManager,
          (method) => ownedSessionClient.refreshAuth(method),
          assembleModelSelection(handle.settingsOwner),
        );
      }
      populatePostActivationSettings(
        settingsService,
        runtimeStateProfile,
        profileName,
        this.defaultDisabledTools,
      );
      return { ...handle, mediaOwner, sessionClient: ownedSessionClient };
    } catch (error) {
      return cleanupAfterFailure(error, () =>
        disposeIsolatedMediaRuntime(handle, mediaOwner, sessionClient),
      );
    }
  }
}
