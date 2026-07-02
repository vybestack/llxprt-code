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
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { SubAgentScope } from './subagent.js';
import type {
  ModelConfig,
  PromptConfig,
  RunConfig,
  ToolConfig,
  OutputConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
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
import { canonicalizeToolName } from './toolGovernance.js';

type RuntimeLoader = (
  options: AgentRuntimeLoaderOptions,
) => Promise<AgentRuntimeLoaderResult>;

type ScopeFactory = typeof SubAgentScope.create;

type RuntimeProfileResolution = {
  effectiveProfile: Profile;
};

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
    const runtimeProfile = await this.resolveRuntimeProfile(profile);
    this.throwIfAborted(
      signal,
      'Subagent launch aborted while resolving runtime profile.',
    );

    const promptConfig = this.buildPromptConfig(
      subagent.systemPrompt,
      request.behaviourPrompts,
    );
    const modelConfig = this.buildModelConfig(runtimeProfile.effectiveProfile);
    const runConfig = this.buildRunConfig(profile, request.runConfig);
    this.throwIfAborted(
      signal,
      'Subagent launch aborted before runtime assembly.',
    );

    const agentRuntimeId = this.createRuntimeId(subagent.name);
    const runtimeResult = await this.createRuntimeBundle(
      { subagent, runtimeProfile, modelConfig, agentRuntimeId },
      signal,
    );
    this.throwIfAborted(
      signal,
      'Subagent launch aborted after runtime assembly completed.',
    );

    const scope = await this.createScopeWithEnvironment(
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
      dispose: this.buildScopeDispose(scope, runtimeResult),
    };
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
    const profileMaxTime = this.getNumberSetting(profile.ephemeralSettings, [
      'subagent.max_time_minutes',
      'max_time_minutes',
    ]);

    const runConfig: RunConfig = {
      max_time_minutes:
        custom?.max_time_minutes ?? profileMaxTime ?? Number.POSITIVE_INFINITY,
    };

    const profileMaxTurns = this.getNumberSetting(profile.ephemeralSettings, [
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

  private async resolveRuntimeProfile(
    profile: Profile,
  ): Promise<RuntimeProfileResolution> {
    if (!isLoadBalancerProfile(profile)) {
      return { effectiveProfile: profile };
    }

    const firstProfileName = profile.profiles[0];
    if (!firstProfileName) {
      throw new Error(
        'Load balancer subagent profile must reference a profile.',
      );
    }

    const effectiveProfile =
      await this.options.profileManager.loadProfile(firstProfileName);
    if (isLoadBalancerProfile(effectiveProfile)) {
      throw new Error(
        `Load balancer subagent profile cannot use nested load balancer profile '${firstProfileName}'.`,
      );
    }

    return { effectiveProfile };
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
    const authKey = this.getStringSetting(profile.ephemeralSettings, [
      'auth-key',
    ]);
    const proxy = this.getStringSetting(profile.ephemeralSettings, [
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
    const allowed = this.getStringArraySetting(profile.ephemeralSettings, [
      'tools.allowed',
      'tools_allowed',
    ]);
    const disabled = this.mergeDefaultDisabledTools(
      this.getStringArraySetting(profile.ephemeralSettings, [
        'tools.disabled',
        'disabled-tools',
      ]),
      allowed,
    );

    return {
      compressionThreshold: this.getNumberSetting(profile.ephemeralSettings, [
        'compression-threshold',
      ]),
      contextLimit: this.getNumberSetting(profile.ephemeralSettings, [
        'context-limit',
      ]),
      preserveThreshold: this.getNumberSetting(profile.ephemeralSettings, [
        'compression-preserve-threshold',
      ]),
      toolFormatOverride: this.getStringSetting(profile.ephemeralSettings, [
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

    const baseUrl = this.getStringSetting(profile.ephemeralSettings, [
      'base-url',
    ]);
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
    const authKey = this.getStringSetting(profile.ephemeralSettings, [
      'auth-key',
    ]);
    if (authKey) {
      service.set('auth-key', authKey);
      service.set(`providers.${provider}.auth-key`, authKey);
    }
    const authKeyName = this.getStringSetting(profile.ephemeralSettings, [
      'auth-key-name',
    ]);
    if (authKeyName) {
      service.set('auth-key-name', authKeyName);
    }

    const authKeyfile = this.getStringSetting(profile.ephemeralSettings, [
      'auth-keyfile',
    ]);
    if (authKeyfile) {
      const expandedKeyfile = authKeyfile.replace(/^~(?=$|[\\/])/, homedir());
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
    const contextLimit = this.getNumberSetting(profile.ephemeralSettings, [
      'context-limit',
    ]);
    if (contextLimit !== undefined) {
      service.set('context-limit', contextLimit);
    }

    const compressionThreshold = this.getNumberSetting(
      profile.ephemeralSettings,
      ['compression-threshold'],
    );
    if (compressionThreshold !== undefined) {
      service.set('compression-threshold', compressionThreshold);
    }

    const preserveThreshold = this.getNumberSetting(profile.ephemeralSettings, [
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
    const toolFormat = this.getStringSetting(profile.ephemeralSettings, [
      'tool-format',
    ]);
    if (toolFormat) {
      service.set('tool-format-override', toolFormat);
    }

    const allowed = this.getStringArraySetting(profile.ephemeralSettings, [
      'tools.allowed',
      'tools_allowed',
    ]);
    if (allowed) {
      service.set('tools.allowed', allowed);
    }

    const disabled = this.mergeDefaultDisabledTools(
      this.getStringArraySetting(profile.ephemeralSettings, [
        'tools.disabled',
        'disabled-tools',
      ]),
      allowed,
    );
    if (disabled) {
      service.set('tools.disabled', disabled);
    }

    const userAgent = this.getStringSetting(profile.ephemeralSettings, [
      'user-agent',
    ]);
    if (userAgent) {
      service.set('user-agent', userAgent);
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
    this.populateProviderSettings(service, provider, profile);
    this.populateAuthSettings(service, provider, profile);
    this.populateCompressionSettings(service, profile);
    this.populateToolAndMiscSettings(service, profile);
  }

  private getNumberSetting(
    settings: Profile['ephemeralSettings'],
    keys: string[],
  ): number | undefined {
    for (const key of keys) {
      const value = this.getSetting(settings, key);
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private getStringSetting(
    settings: Profile['ephemeralSettings'],
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = this.getSetting(settings, key);
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private getStringArraySetting(
    settings: Profile['ephemeralSettings'],
    keys: string[],
  ): string[] | undefined {
    for (const key of keys) {
      const value = this.getSetting(settings, key);
      if (Array.isArray(value)) {
        return value.map(String);
      }
    }
    return undefined;
  }

  private getSetting(
    settings: Profile['ephemeralSettings'],
    key: string,
  ): unknown {
    return (settings as Record<string, unknown>)[key];
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
    const baseUrl = this.getStringSetting(profile.ephemeralSettings, [
      'base-url',
    ]);

    return createAgentRuntimeState({
      runtimeId: agentRuntimeId,
      provider: profile.provider,
      model: modelConfig.model,
      baseUrl,
      proxyUrl: this.getStringSetting(profile.ephemeralSettings, [
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
  ): Promise<AgentRuntimeLoaderResult> {
    const { runtimeProfile, modelConfig, agentRuntimeId, subagent } = params;
    const { effectiveProfile } = runtimeProfile;

    this.throwIfAborted(
      signal,
      'Subagent launch aborted before runtime state.',
    );
    const runtimeState = this.createRuntimeState(
      effectiveProfile,
      modelConfig,
      agentRuntimeId,
    );
    const settingsService = createRuntimeSettingsService();
    this.populateSettingsService(
      settingsService,
      effectiveProfile,
      subagent.profile,
    );

    const providerRuntime: ProviderRuntimeContext =
      createSettingsProviderRuntimeContext({
        settingsService,
        config: this.options.foregroundConfig,
        runtimeId: agentRuntimeId,
        metadata: {
          source: 'SubagentOrchestrator',
          subagent: subagent.name,
        },
      });

    const settingsSnapshot = this.createSettingsSnapshot(effectiveProfile);
    const contentGeneratorConfig = this.buildContentGeneratorConfig(
      effectiveProfile,
      modelConfig,
    );
    const providerManager =
      typeof this.options.foregroundConfig.getProviderManager === 'function'
        ? this.options.foregroundConfig.getProviderManager()
        : undefined;
    if (providerManager) {
      contentGeneratorConfig.providerManager = providerManager;
    }

    const toolRegistry: ToolRegistry | undefined =
      typeof this.options.foregroundConfig.getToolRegistry === 'function'
        ? this.options.foregroundConfig.getToolRegistry()
        : undefined;

    const loaderOptions: AgentRuntimeLoaderOptions = {
      profile: {
        config: this.options.foregroundConfig,
        state: runtimeState,
        settings: settingsSnapshot,
        providerRuntime,
        contentGeneratorConfig,
        toolRegistry,
        providerManager,
      },
      signal,
    };

    return this.runtimeLoader(loaderOptions);
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
