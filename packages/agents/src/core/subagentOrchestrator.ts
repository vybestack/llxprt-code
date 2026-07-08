/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import {
  isInternalSettingKey,
  type Profile,
  type ProfileManager,
} from '@vybestack/llxprt-code-settings';
import {
  resolveRuntimeProfile,
  buildActivationCliOverrides,
  type RuntimeProfileResolution,
} from './subagentProfileResolution.js';
import {
  expandTilde,
  getNumberSetting,
  getStringSetting,
  getStringArraySetting,
} from './subagentSettingsAccess.js';
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
import fs from 'node:fs';
import path from 'node:path';

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
import { registerProvidersOntoManager } from '../api/createAgent.js';
import { executeProviderActivation } from '../api/providerActivationExecutor.js';
import { canonicalizeToolName } from './toolGovernance.js';

type RuntimeLoader = (
  options: AgentRuntimeLoaderOptions,
) => Promise<AgentRuntimeLoaderResult>;

type ScopeFactory = typeof SubAgentScope.create;

const createAbortError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const DEFAULT_DISABLED_TOOLS = [
  'google_web_fetch',
  'google_web_search',
] as const;

const normalizeDefaultToolSet = (tools: readonly string[]): Set<string> =>
  new Set(tools.map((tool) => canonicalizeToolName(tool)).filter(Boolean));

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
      if (typeof scope.dispose === 'function') {
        scope.dispose();
      }

      const history = firstDefinedHistory(
        runtimeResult.history,
        scope.runtimeContext.history,
      );
      disposeHistoryLike(history);

      await isolatedHandle.cleanup();
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
    const modelConfig = this.buildModelConfig(runtimeProfile.primaryProfile);
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
      if (scope !== undefined) {
        await this.buildScopeDispose(scope, runtimeResult, isolatedHandle)();
      } else {
        disposeHistoryLike(runtimeResult.history);
        await isolatedHandle.cleanup();
      }
      throw error;
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

  private createSettingsSnapshot(profile: Profile): ReadonlySettingsSnapshot {
    const allowed = getStringArraySetting(profile.ephemeralSettings, [
      'tools.allowed',
      'tools_allowed',
    ]);
    const disabled = this.mergeDefaultDisabledTools(
      getStringArraySetting(profile.ephemeralSettings, [
        'tools.disabled',
        'disabled-tools',
      ]),
      allowed,
    );

    return {
      compressionThreshold: getNumberSetting(profile.ephemeralSettings, [
        'compression-threshold',
      ]),
      contextLimit: getNumberSetting(profile.ephemeralSettings, [
        'context-limit',
      ]),
      preserveThreshold: getNumberSetting(profile.ephemeralSettings, [
        'compression-preserve-threshold',
      ]),
      toolFormatOverride: getStringSetting(profile.ephemeralSettings, [
        'tool-format',
      ]),
      tools: {
        allowed,
        disabled,
      },
    };
  }

  private populateProviderSettings(
    service: SettingsService,
    provider: string,
    profile: Profile,
  ): void {
    const temperature = profile.modelParams.temperature;
    if (typeof temperature === 'number') {
      service.set(`providers.${provider}.temperature`, temperature);
    }

    const maxTokens = profile.modelParams.max_tokens;
    if (typeof maxTokens === 'number') {
      service.set(`providers.${provider}.maxTokens`, maxTokens);
    }

    const baseUrl = getStringSetting(profile.ephemeralSettings, ['base-url']);
    if (baseUrl) {
      service.set(`providers.${provider}.base-url`, baseUrl);
    } else {
      service.set(`providers.${provider}.base-url`, undefined);
    }
  }

  private populateAuthSettings(
    service: SettingsService,
    provider: string,
    profile: Profile,
  ): void {
    const authKey = getStringSetting(profile.ephemeralSettings, ['auth-key']);
    if (authKey) {
      service.set('auth-key', authKey);
      service.set(`providers.${provider}.auth-key`, authKey);
    }
    const authKeyName = getStringSetting(profile.ephemeralSettings, [
      'auth-key-name',
    ]);
    if (authKeyName) {
      service.set('auth-key-name', authKeyName);
    }

    const authKeyfile = getStringSetting(profile.ephemeralSettings, [
      'auth-keyfile',
    ]);
    if (authKeyfile) {
      const expandedKeyfile = expandTilde(authKeyfile);
      service.set('auth-keyfile', expandedKeyfile);
      service.set(`providers.${provider}.auth-keyfile`, expandedKeyfile);
      const authKey = service.get(`providers.${provider}.auth-key`);
      const isNullOrUndefined = authKey === undefined || authKey === null;
      const isEmptyPrimitive =
        authKey === '' || authKey === false || authKey === 0;
      const isNumericNaN = typeof authKey === 'number' && Number.isNaN(authKey);
      const shouldLoadApiKeyfile =
        isNullOrUndefined || isEmptyPrimitive || isNumericNaN;
      if (shouldLoadApiKeyfile) {
        this.tryLoadApiKeyFromKeyfile(provider, expandedKeyfile, service);
      }
    }
  }

  private tryLoadApiKeyFromKeyfile(
    provider: string,
    expandedKeyfile: string,
    service: SettingsService,
  ): void {
    try {
      const resolvedPath = path.resolve(expandedKeyfile);
      if (fs.existsSync(resolvedPath)) {
        const content = fs.readFileSync(resolvedPath, 'utf8').trim();
        if (content !== '') {
          service.set(`providers.${provider}.auth-key`, content);
        }
      }
    } catch (error) {
      debugLogger.warn(
        `SubagentOrchestrator: unable to read auth key file '${expandedKeyfile}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private populateCompressionSettings(
    service: SettingsService,
    profile: Profile,
  ): void {
    const contextLimit = getNumberSetting(profile.ephemeralSettings, [
      'context-limit',
    ]);
    if (contextLimit !== undefined) {
      service.set('context-limit', contextLimit);
    }

    const compressionThreshold = getNumberSetting(profile.ephemeralSettings, [
      'compression-threshold',
    ]);
    if (compressionThreshold !== undefined) {
      service.set('compression-threshold', compressionThreshold);
    }

    const preserveThreshold = getNumberSetting(profile.ephemeralSettings, [
      'compression-preserve-threshold',
    ]);
    if (preserveThreshold !== undefined) {
      service.set('compression-preserve-threshold', preserveThreshold);
    }
  }

  private populateToolAndMiscSettings(
    service: SettingsService,
    profile: Profile,
  ): void {
    const toolFormat = getStringSetting(profile.ephemeralSettings, [
      'tool-format',
    ]);
    if (toolFormat) {
      service.set('tool-format-override', toolFormat);
    }

    const allowed = getStringArraySetting(profile.ephemeralSettings, [
      'tools.allowed',
      'tools_allowed',
    ]);
    if (allowed) {
      service.set('tools.allowed', allowed);
    }

    const disabled = this.mergeDefaultDisabledTools(
      getStringArraySetting(profile.ephemeralSettings, [
        'tools.disabled',
        'disabled-tools',
      ]),
      allowed,
    );
    if (disabled) {
      service.set('tools.disabled', disabled);
    }

    const userAgent = getStringSetting(profile.ephemeralSettings, [
      'user-agent',
    ]);
    if (userAgent) {
      service.set('user-agent', userAgent);
    }
  }

  /**
   * Ephemeral keys that are applied through dedicated, provider-scoped or
   * transformed paths (auth, base-url, model params, tool governance). These
   * are skipped by {@link populateGeneralEphemerals} so it does not clobber the
   * specialized handling with a raw global copy.
   */
  private static readonly SPECIALLY_HANDLED_EPHEMERAL_KEYS: ReadonlySet<string> =
    new Set([
      'auth-key',
      'auth-keyfile',
      'auth-key-name',
      'base-url',
      'tool-format',
      'tools.allowed',
      'tools_allowed',
      'tools.disabled',
      'disabled-tools',
    ]);

  /**
   * Copies all remaining profile ephemeral settings onto the subagent's
   * settings service as GLOBAL settings, mirroring the foreground profile-load
   * path (providers/runtime/profileApplication.ts `applyNonAuthEphemerals`).
   *
   * Without this, only a hand-picked subset (compression, tool governance,
   * auth) reached the subagent runtime, so settings such as `reasoning.*`,
   * `streaming`, `emojifilter`, etc. were silently dropped. Those ephemerals
   * feed `buildEphemeralsSnapshot` → the provider invocation's
   * modelBehavior/cliSettings, so dropping them produced malformed provider
   * requests (e.g. the z.ai endpoint rejected reasoning-less/wrong-shaped GLM
   * requests with error 1213). Keys handled by dedicated paths (auth, base-url,
   * tool governance) and internal-only keys are skipped.
   */
  private populateGeneralEphemerals(
    service: SettingsService,
    profile: Profile,
  ): void {
    const ephemerals = profile.ephemeralSettings as
      | Record<string, unknown>
      | undefined;
    if (ephemerals === undefined) {
      return;
    }
    for (const [key, value] of Object.entries(ephemerals)) {
      if (
        SubagentOrchestrator.SPECIALLY_HANDLED_EPHEMERAL_KEYS.has(key) ||
        isInternalSettingKey(key)
      ) {
        continue;
      }
      // null means "explicitly unset" — clear the key rather than storing null.
      service.set(key, value === null ? undefined : value);
    }
  }

  private populateSettingsService(
    service: SettingsService,
    profile: Profile,
    profileName: string,
  ): void {
    const provider = profile.provider;
    service.setCurrentProfileName(profileName);
    service.set('activeProvider', provider);
    service.set(`providers.${provider}.model`, profile.model);
    // Copy the general ephemerals FIRST so the dedicated populate* helpers below
    // (which apply provider-scoped / transformed values) take precedence.
    this.populateGeneralEphemerals(service, profile);
    this.populateProviderSettings(service, provider, profile);
    this.populateAuthSettings(service, provider, profile);
    this.populateCompressionSettings(service, profile);
    this.populateToolAndMiscSettings(service, profile);
  }

  private mergeDefaultDisabledTools(
    disabled: string[] | undefined,
    allowed: string[] | undefined,
  ): string[] | undefined {
    const disabledSource = Array.isArray(disabled) ? disabled : [];
    const allowedSet = new Set(
      (allowed ?? [])
        .map((tool) => canonicalizeToolName(tool))
        .filter((tool) => tool.length > 0),
    );

    const merged: string[] = [];
    const seen = new Set<string>();
    const addTool = (toolName: string, respectAllowed: boolean) => {
      const canonical = canonicalizeToolName(toolName);
      if (
        !canonical ||
        seen.has(canonical) ||
        (respectAllowed && allowedSet.has(canonical))
      ) {
        return;
      }
      seen.add(canonical);
      merged.push(canonical);
    };

    for (const tool of disabledSource) {
      addTool(tool, false);
    }

    for (const tool of this.defaultDisabledTools) {
      addTool(tool, true);
    }

    return merged.length > 0 ? merged : undefined;
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
    const { effectiveProfile, primaryProfile } = runtimeProfile;

    this.throwIfAborted(
      signal,
      'Subagent launch aborted before runtime state.',
    );
    // Runtime-state, settings-service population, and provider activation are
    // derived from the concrete primary profile so a load-balancer profile
    // (provider:'' / model:'') never reaches createAgentRuntimeState, which
    // rejects an empty provider/model. The load-balancer routing itself is
    // preserved via the effectiveProfile passed to the behaviour-scoped
    // settings snapshot below.
    const runtimeState = this.createRuntimeState(
      primaryProfile,
      modelConfig,
      agentRuntimeId,
    );
    const settingsService = createRuntimeSettingsService();
    this.populateSettingsService(
      settingsService,
      primaryProfile,
      subagent.profile,
    );

    const isolatedHandle = await this.createIsolatedRuntime(
      settingsService,
      primaryProfile,
      subagent.name,
      agentRuntimeId,
    );

    try {
      const providerRuntime: ProviderRuntimeContext =
        createSettingsProviderRuntimeContext({
          settingsService: isolatedHandle.settingsService,
          config: isolatedHandle.config,
          runtimeId: agentRuntimeId,
          metadata: {
            source: 'SubagentOrchestrator',
            subagent: subagent.name,
          },
        });

      // Behaviour-scoped settings (tool governance, compression) honour the
      // effective profile so a load-balancer profile's own ephemerals win.
      const settingsSnapshot = this.createSettingsSnapshot(effectiveProfile);
      // Credentials/model resolve from the concrete primary profile: a
      // load-balancer profile carries no auth-key of its own (each referenced
      // member does).
      const contentGeneratorConfig = this.buildContentGeneratorConfig(
        primaryProfile,
        modelConfig,
      );
      contentGeneratorConfig.providerManager = isolatedHandle.providerManager;

      const loaderOptions = this.buildRuntimeLoaderOptions({
        isolatedHandle,
        runtimeState,
        settingsSnapshot,
        providerRuntime,
        contentGeneratorConfig,
        signal,
      });

      // Build the runtime (incl. the content generator, which resolves
      // provider/auth state) INSIDE the isolated runtime's async scope. Like
      // executeProviderActivation, the loader can consult the ambient
      // AsyncLocalStorage runtime scope, which handle.activate() leaks via
      // enterWith. For parallel subagents (the task tool runs tool calls with
      // Promise.all) the last activation's leaked scope would otherwise win, so
      // an earlier subagent's content generator could bind to a sibling's
      // runtime and its requests would never resolve (5-min first-response
      // timeout). runWithRuntimeScope pins the build to THIS runtime
      // (Issue #2410 — parallel subagents).
      const runtimeResult = await runWithRuntimeScope(
        {
          runtimeId: isolatedHandle.runtimeId,
          metadata: isolatedHandle.metadata,
        },
        () => this.runtimeLoader(loaderOptions),
      );
      return { runtimeResult, isolatedHandle };
    } catch (error) {
      await isolatedHandle.cleanup();
      throw error;
    }
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
    primaryProfile: Profile,
    subagentName: string,
    agentRuntimeId: string,
  ): Promise<IsolatedRuntimeContextHandle> {
    // Do NOT pass the foreground config — the isolated runtime must get its
    // own Config so executeProviderActivation operates on the subagent's
    // provider, not the parent's (Issue #2410). The primary profile always
    // carries a concrete provider/model (a load-balancer profile resolves to
    // its first referenced member).
    const handle = createIsolatedRuntimeContext({
      runtimeId: agentRuntimeId,
      settingsService,
      messageBus: this.options.messageBus,
      model: primaryProfile.model,
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
        () =>
          executeProviderActivation(handle.config, {
            provider: primaryProfile.provider,
            model: primaryProfile.model,
            modelParams: primaryProfile.modelParams,
            // Carry the profile's credential/endpoint ephemerals into the
            // activation so the isolated provider talks to the RIGHT endpoint
            // with the RIGHT key. Without base-url, a profile like zai
            // (provider 'anthropic', base-url https://api.z.ai/api/anthropic)
            // would fall back to the provider default (api.anthropic.com) and
            // its z.ai key would never authenticate — the request stalls until
            // the 5-minute first-response timeout and the subagent returns an
            // empty result. auth-key-name/auth-keyfile are resolved the same
            // way the CLI bootstrap applies them (Issue #2410).
            cliOverrides: buildActivationCliOverrides(primaryProfile),
          }),
      );
    } catch (error) {
      await handle.cleanup();
      throw error;
    }

    return handle;
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
