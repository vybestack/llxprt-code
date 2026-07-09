/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import {
  isLoadBalancerProfile,
  type Profile,
  type ProfileManager,
} from '@vybestack/llxprt-code-settings';
import {
  resolveRuntimeProfile,
  buildActivationCliOverrides,
  type RuntimeProfileResolution,
} from './subagentProfileResolution.js';
import {
  getNumberSetting,
  getStringSetting,
} from './subagentSettingsAccess.js';
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

import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createRuntimeSettingsService,
  createSettingsProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import {
  loadAgentRuntime,
  type AgentRuntimeLoaderOptions,
  type AgentRuntimeLoaderResult,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import {
  createIsolatedRuntimeContext,
  runWithRuntimeScope,
  type IsolatedRuntimeContextHandle,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { applyProfileWithGuards } from '@vybestack/llxprt-code-providers/runtime/profileApplication.js';
import { registerProvidersOntoManager } from '../api/createAgent.js';
import { executeProviderActivation } from '../api/providerActivationExecutor.js';
import { AggregateDisposeError } from '../api/disposeErrors.js';

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
  subagentManager: SubagentManager;
  profileManager: ProfileManager;
  foregroundConfig: Config;
  runtimeLoader?: RuntimeLoader;
  scopeFactory?: ScopeFactory;
  idFactory?: () => string;
  /**
   * Session/runtime MessageBus threaded into the SubAgentScope so
   * non-interactive subagent tool execution can satisfy
   * Config.getOrCreateScheduler's explicit MessageBus dependency (Issue #2312).
   */
  messageBus?: MessageBus;
}

/**
 * Light-weight orchestrator responsible for resolving subagent configuration,
 * building isolated runtime bundles, and launching {@link SubAgentScope} instances.
 *
 * @plan PLAN-20251029-SUBAGENTORCHESTRATION
 * @requirement REQ-SUBAGENT-ORCH-001, REQ-SUBAGENT-ORCH-002
 */
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
        () => isolatedHandle.cleanup(),
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
        environmentContextLoader: async (_runtime) =>
          getEnvironmentContext(this.options.foregroundConfig),
        messageBus: this.options.messageBus,
      },
      signal,
    );
  }

  /**
   * Launches a subagent by name, returning the created {@link SubAgentScope}
   * and associated agent metadata.
   */
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
    const runConfig = this.buildRunConfig(profile, request.runConfig);
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
      await this.cleanupAfterLaunchFailure(
        scope,
        runtimeResult,
        isolatedHandle,
      );
      throw error;
    }
  }

  private async cleanupAfterLaunchFailure(
    scope: SubAgentScopeInstance | undefined,
    runtimeResult: AgentRuntimeLoaderResult,
    isolatedHandle: IsolatedRuntimeContextHandle,
  ): Promise<void> {
    try {
      if (scope !== undefined) {
        await this.buildScopeDispose(scope, runtimeResult, isolatedHandle)();
      } else {
        await this.cleanupRuntimeArtifacts(runtimeResult, isolatedHandle);
      }
    } catch (disposeError) {
      debugLogger.warn(
        `SubagentOrchestrator: cleanup after launch failure also failed: ${
          disposeError instanceof Error
            ? disposeError.message
            : String(disposeError)
        }`,
      );
    }
  }

  private async cleanupRuntimeArtifacts(
    runtimeResult: AgentRuntimeLoaderResult,
    isolatedHandle: IsolatedRuntimeContextHandle,
  ): Promise<void> {
    await runCleanupSteps([
      () => disposeHistoryLike(runtimeResult.history),
      () => isolatedHandle.cleanup(),
    ]);
  }

  private async cleanupIsolatedHandleAfterFailure(
    isolatedHandle: IsolatedRuntimeContextHandle,
  ): Promise<void> {
    try {
      await isolatedHandle.cleanup();
    } catch (cleanupError) {
      debugLogger.warn(
        `SubagentOrchestrator: isolated runtime cleanup failed: ${
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        }`,
      );
    }
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

  private buildRunConfig(profile: Profile, custom?: RunConfig): RunConfig {
    const profileMaxTime = getNumberSetting(profile.ephemeralSettings, [
      'subagent.max_time_minutes',
      'max_time_minutes',
    ]);

    const runConfig: RunConfig = {
      max_time_minutes:
        custom?.max_time_minutes ?? profileMaxTime ?? Number.POSITIVE_INFINITY,
    };

    const profileMaxTurns = getNumberSetting(profile.ephemeralSettings, [
      'maxTurnsPerPrompt',
    ]);

    const parentMaxTurns = this.getParentMaxTurns();

    const maxTurns = custom?.max_turns ?? profileMaxTurns ?? parentMaxTurns;

    if (maxTurns === undefined) {
      runConfig.max_turns = 200;
    } else if (maxTurns > 0) {
      runConfig.max_turns = Math.floor(maxTurns);
    }

    if (custom?.grace_period_seconds !== undefined) {
      runConfig.grace_period_seconds = custom.grace_period_seconds;
    }

    return runConfig;
  }

  private getParentMaxTurns(): number | undefined {
    const config = this.options.foregroundConfig as Config & {
      getEphemeralSetting?: (key: string) => unknown;
    };
    if (typeof config.getEphemeralSetting !== 'function') {
      return undefined;
    }
    const value = config.getEphemeralSetting('maxTurnsPerPrompt');
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (value === -1 || value > 0)
    ) {
      return value;
    }
    return undefined;
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
    );
    const settingsService = createRuntimeSettingsService();
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
      await this.cleanupIsolatedHandleAfterFailure(isolatedHandle);
      throw error;
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
    const providerRuntime = createSettingsProviderRuntimeContext({
      settingsService: params.isolatedHandle.settingsService,
      config: params.isolatedHandle.config,
      runtimeId: params.isolatedHandle.runtimeId,
      metadata: {
        source: 'SubagentOrchestrator',
        subagent: params.subagentName,
      },
    });
    const settingsSnapshot = createSettingsSnapshot(
      params.effectiveProfile,
      this.defaultDisabledTools,
    );
    const contentGeneratorConfig = this.buildContentGeneratorConfig(
      params.runtimeStateProfile,
      params.modelConfig,
    );
    contentGeneratorConfig.providerManager =
      params.isolatedHandle.providerManager;
    const loaderOptions = this.buildRuntimeLoaderOptions({
      isolatedHandle: params.isolatedHandle,
      runtimeState: params.runtimeState,
      settingsSnapshot,
      providerRuntime,
      contentGeneratorConfig,
      signal: params.signal,
    });
    return runWithRuntimeScope(
      {
        runtimeId: params.isolatedHandle.runtimeId,
        metadata: params.isolatedHandle.metadata,
      },
      () => this.runtimeLoader(loaderOptions),
    );
  }

  private buildRuntimeLoaderOptions(params: {
    isolatedHandle: IsolatedRuntimeContextHandle;
    runtimeState: AgentRuntimeState;
    settingsSnapshot: ReadonlySettingsSnapshot;
    providerRuntime: ProviderRuntimeContext;
    contentGeneratorConfig: ContentGeneratorConfig;
    signal?: AbortSignal;
  }): AgentRuntimeLoaderOptions {
    const toolRegistry: ToolRegistry | undefined =
      typeof this.options.foregroundConfig.getToolRegistry === 'function'
        ? this.options.foregroundConfig.getToolRegistry()
        : undefined;

    return {
      profile: {
        config: params.isolatedHandle.config,
        state: params.runtimeState,
        settings: params.settingsSnapshot,
        providerRuntime: params.providerRuntime,
        contentGeneratorConfig: params.contentGeneratorConfig,
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
    const handle = createIsolatedRuntimeContext({
      runtimeId: agentRuntimeId,
      settingsService,
      profileManager: this.options.profileManager,
      messageBus: this.options.messageBus,
      model: activationProfile.model,
      metadata: {
        source: 'SubagentOrchestrator',
        subagent: subagentName,
      },
      prepare: (context) => {
        registerProvidersOntoManager(
          context.providerManager,
          {
            settingsService: context.settingsService,
            runtimeId: context.runtimeId,
            metadata: context.metadata,
          },
          context.config,
        );
      },
    });

    try {
      await handle.activate();

      // Run provider activation INSIDE the isolated runtime's async scope.
      // executeProviderActivation -> switchActiveProvider resolves the active
      // runtime from AsyncLocalStorage (resolveActiveRuntimeIdentity). Because
      // handle.activate() binds the scope via enterWith (a persistent, NOT
      // callback-scoped mutation), two subagents launched in parallel (the task
      // tool runs tool calls via Promise.all) would clobber each other's
      // ambient scope, so one subagent would activate against the other's
      // runtime and hang. Wrapping the activation in runWithRuntimeScope pins it
      // to THIS subagent's runtime deterministically, regardless of interleaving
      // (Issue #2410 — parallel subagents).
      await runWithRuntimeScope(
        { runtimeId: handle.runtimeId, metadata: handle.metadata },
        async () => {
          if (isLoadBalancerActivation) {
            // applyProfileWithGuards reads getCliRuntimeServices(), which is
            // scoped by runWithRuntimeScope above to this isolated runtime id.
            await applyProfileWithGuards(activationProfile, {
              profileName,
              profileManager: this.options.profileManager,
            });
          } else {
            await executeProviderActivation(handle.config, {
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
            });
          }
          populatePostActivationSettings(
            settingsService,
            runtimeStateProfile,
            profileName,
            this.defaultDisabledTools,
          );
        },
      );
    } catch (error) {
      await handle.cleanup();
      throw error;
    }

    return handle;
  }
}

async function runCleanupSteps(
  steps: ReadonlyArray<() => unknown | Promise<unknown>>,
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateDisposeError(errors);
  }
}

/**
 * Boundary-validation helper: disposes (or clears) a history-like object that
 * may be `undefined`/`null` at runtime. Typed `unknown` so the guards are
 * genuinely necessary (no lint suppression directive needed).
 */
function disposeHistoryLike(history: unknown): void {
  if (history === undefined || history === null) {
    return;
  }
  const disposable = (history as { dispose?: () => void }).dispose;
  if (typeof disposable === 'function') {
    disposable.call(history);
    return;
  }
  const clearable = history as {
    clear?: () => void;
    removeAllListeners?: () => void;
  };
  if (typeof clearable.clear === 'function') {
    clearable.clear();
    if (typeof clearable.removeAllListeners === 'function') {
      clearable.removeAllListeners();
    }
  }
}

/**
 * Boundary-validation helper: picks the first defined history source without
 * tripping `no-unnecessary-condition` (both args are statically required).
 */
function firstDefinedHistory(primary: unknown, fallback: unknown): unknown {
  return primary ?? fallback;
}
