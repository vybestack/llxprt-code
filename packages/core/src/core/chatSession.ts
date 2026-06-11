/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-lines -- ChatSession coordinates legacy decomposed modules; further splitting is outside this change. */

// ChatSession — thin coordinator that wires up the decomposed modules.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  SendMessageParameters,
  Tool,
  PartListUnion,
} from '@google/genai';
import type { CompletedToolCall } from './coreToolScheduler.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '../runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '../runtime/contracts/RuntimeProviderChat.js';
import { DebugLogger } from '../debug/index.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  ToolRegistryView,
} from '../runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { triggerPreCompressHook } from './lifecycleHookTriggers.js';
import { PreCompressTrigger } from '../hooks/types.js';
import type { ContentGenerator } from './contentGenerator.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { getProviderKeyStorage } from '../storage/provider-key-storage.js';

import { createRuntimeInvocationContext } from '../runtime/RuntimeInvocationContext.js';
import { isLoadBalancerProfile } from '@vybestack/llxprt-code-settings';
import type {
  LoadBalancerProfile,
  StandardProfile,
} from '@vybestack/llxprt-code-settings';

// Decomposed modules
import { CompressionHandler } from './compression/CompressionHandler.js';
import { ConversationManager } from './ConversationManager.js';
import { TurnProcessor } from './TurnProcessor.js';
import { StreamProcessor } from './StreamProcessor.js';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
import {
  convertPartListUnionToIContent,
  convertIContentToResponse,
  validateHistory,
} from './MessageConverter.js';

// Re-exports — consumers import from './chatSession.js'
export { StreamEventType, StreamEvent } from './chatSessionTypes.js';
export {
  InvalidStreamError,
  EmptyStreamError,
  isSchemaDepthError,
} from './chatSessionTypes.js';
export {
  aggregateTextWithSpacing,
  isValidNonThoughtTextPart,
} from './MessageConverter.js';

import type { StreamEvent } from './chatSessionTypes.js';
import type {
  CompressionContext,
  CompressionProviderResult,
} from './compression/types.js';
import { CompressionProfileNotFoundError } from './compression/types.js';
import type { PerformCompressionResult } from './turn.js';
import type { Config } from '../config/config.js';

/**
 * Error thrown when agent execution is stopped by a hook.
 */
export class AgentExecutionStoppedError extends Error {
  readonly reason: string;
  readonly systemMessage?: string;
  readonly contextCleared?: boolean;

  constructor(
    reason: string,
    systemMessage?: string,
    contextCleared?: boolean,
  ) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty systemMessage should fall through to reason
    super(`Agent execution stopped: ${systemMessage || reason}`);
    this.name = 'AgentExecutionStoppedError';
    this.reason = reason;
    this.systemMessage = systemMessage;
    this.contextCleared = contextCleared;
  }
}

/**
 * Error thrown when agent execution is blocked by a hook.
 */
export class AgentExecutionBlockedError extends Error {
  readonly reason: string;
  readonly systemMessage?: string;
  readonly syntheticResponse?: GenerateContentResponse;
  readonly contextCleared?: boolean;

  constructor(
    reason: string,
    syntheticResponse?: GenerateContentResponse,
    systemMessage?: string,
    contextCleared?: boolean,
  ) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty systemMessage should fall through to reason
    super(`Agent execution blocked: ${systemMessage || reason}`);
    this.name = 'AgentExecutionBlockedError';
    this.reason = reason;
    this.systemMessage = systemMessage;
    this.syntheticResponse = syntheticResponse;
    this.contextCleared = contextCleared;
  }
}

interface CompressionLoadBalancerCandidate {
  profileName: string;
  provider: IProvider;
  runtime: ProviderRuntimeContext;
  config: Config | undefined;
  resolved: RuntimeGenerateChatOptions['resolved'];
  invocation: NonNullable<RuntimeGenerateChatOptions['invocation']>;
}

class CompressionLoadBalancingProvider implements IProvider {
  readonly name = 'load-balancer';
  private readonly selectedRoundRobinCandidate?: CompressionLoadBalancerCandidate;

  constructor(
    private readonly strategy: 'round-robin' | 'failover',
    private readonly candidates: readonly CompressionLoadBalancerCandidate[],
    initialIndex: number,
  ) {
    if (candidates.length === 0) {
      throw new Error('Load-balanced compression profile requires subprofiles');
    }
    if (strategy === 'round-robin') {
      this.selectedRoundRobinCandidate =
        this.candidates[initialIndex % this.candidates.length];
    }
  }

  async getModels() {
    return [];
  }

  getDefaultModel(): string {
    return this.candidates[0]?.resolved?.model ?? '';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(toolName: string): Promise<unknown> {
    throw new Error(
      `Server tool '${toolName}' not supported by compression load-balancer provider`,
    );
  }

  generateChatCompletion(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(content: IContent[]): AsyncIterableIterator<IContent>;
  async *generateChatCompletion(
    optionsOrContent: RuntimeGenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    const options = Array.isArray(optionsOrContent)
      ? { contents: optionsOrContent }
      : optionsOrContent;

    if (this.strategy === 'failover') {
      yield* this.generateWithFailover(options);
      return;
    }

    yield* this.generateWithCandidate(
      this.selectedRoundRobinCandidate ?? this.candidates[0],
      options,
    );
  }

  private async *generateWithFailover(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    let lastError: unknown;
    for (const candidate of this.candidates) {
      try {
        const bufferedChunks: IContent[] = [];
        for await (const chunk of this.generateWithCandidate(
          candidate,
          options,
        )) {
          bufferedChunks.push(chunk);
        }
        yield* bufferedChunks;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async *generateWithCandidate(
    candidate: CompressionLoadBalancerCandidate,
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const candidateOptions: RuntimeGenerateChatOptions = {
      ...options,
      runtime: candidate.runtime,
      settings: candidate.runtime
        .settingsService as RuntimeGenerateChatOptions['settings'],
      config: candidate.config,
      resolved: {
        ...options.resolved,
        ...candidate.resolved,
      },
      invocation: candidate.invocation,
      metadata: {
        ...options.metadata,
        ...(candidate.invocation.metadata as Record<string, unknown>),
        selectedCompressionProfile: candidate.profileName,
      },
    };
    yield* candidate.provider.generateChatCompletion(candidateOptions);
  }
}

/**
 * Chat session that enables sending messages to the model with previous
 * conversation context.
 *
 * @remarks
 * The session maintains all the turns between user and model.
 * Delegates to focused modules: CompressionHandler, ConversationManager,
 * TurnProcessor, StreamProcessor, DirectMessageProcessor.
 */
export class ChatSession {
  private logger = new DebugLogger('llxprt:gemini:chat');
  private readonly runtimeState: AgentRuntimeState;
  private readonly historyService: HistoryService;
  private readonly runtimeContext: AgentRuntimeContext;
  private readonly generationConfig: GenerateContentConfig;

  // Composed modules
  private readonly compressionHandler: CompressionHandler;
  private readonly conversationManager: ConversationManager;
  private readonly turnProcessor: TurnProcessor;
  private readonly streamProcessor: StreamProcessor;
  private readonly directMessageProcessor: DirectMessageProcessor;
  private readonly compressionLoadBalancerRoundRobinIndexes = new Map<
    string,
    number
  >();

  constructor(
    view: AgentRuntimeContext,
    contentGenerator: ContentGenerator,
    generationConfig: GenerateContentConfig = {},
    initialHistory: Content[] = [],
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Gemini chat runtime payloads.
    if (view == null) {
      throw new Error('AgentRuntimeContext is required for ChatSession');
    }

    this.runtimeContext = view;
    this.runtimeState = view.state;
    this.historyService = view.history;
    this.generationConfig = generationConfig;
    void contentGenerator;

    // Wire density-dirty tracking on historyService.add
    this._installDensityWrapper();

    validateHistory(initialHistory);

    const model = this.runtimeState.model;
    this.logger.debug('ChatSession initialized:', {
      model,
      initialHistoryLength: initialHistory.length,
      hasHistoryService: true,
      hasRuntimeState: true,
    });

    // Create composed modules
    const providerResolver = (ctx: string) =>
      this.resolveProviderForRuntime(ctx);
    const providerRuntimeBuilder = (s: string, m?: Record<string, unknown>) =>
      this.buildProviderRuntime(s, m);
    const makePositionMatcher = () => this._makePositionMatcher();
    const resolveBaseUrl = (p: IProvider) => this.resolveProviderBaseUrl(p);

    this.compressionHandler = new CompressionHandler(
      view,
      this.historyService,
      this.generationConfig,
      this.resolveCompressionProvider.bind(this),
      async (context: CompressionContext) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Gemini chat runtime payloads.
        const config = view.providerRuntime?.config;
        if (config) {
          await triggerPreCompressHook(
            config,
            context.trigger === 'auto'
              ? PreCompressTrigger.Auto
              : PreCompressTrigger.Manual,
          );
        }
      },
    );

    this.conversationManager = new ConversationManager(
      this.historyService,
      view,
      model,
    );

    this.conversationManager.importInitialHistory(initialHistory, model);

    this.streamProcessor = new StreamProcessor(
      view,
      this.conversationManager,
      this.compressionHandler,
      providerResolver,
      providerRuntimeBuilder,
      this.historyService,
      this.generationConfig,
    );

    this.turnProcessor = new TurnProcessor(
      view,
      this.compressionHandler,
      providerResolver,
      providerRuntimeBuilder,
      this.generationConfig,
      this.historyService,
      this.streamProcessor,
      makePositionMatcher,
      resolveBaseUrl,
    );

    this.directMessageProcessor = new DirectMessageProcessor(
      view,
      providerResolver,
      providerRuntimeBuilder,
      this.historyService,
      makePositionMatcher,
    );
  }

  // ── Density wrapper ──────────────────────────────────────────────

  private static readonly DENSITY_WRAPPED = Symbol('densityWrapped');

  private _installDensityWrapper(): void {
    if (typeof this.historyService.add !== 'function') return;
    const hs = this.historyService as unknown as Record<symbol, unknown>;
    if (hs[ChatSession.DENSITY_WRAPPED] === true) return;
    const originalAdd = this.historyService.add.bind(this.historyService);
    this.historyService.add = (...args: Parameters<typeof originalAdd>) => {
      const result = originalAdd(...args);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Gemini chat runtime payloads.
      this.compressionHandler?.markDensityDirty();
      return result;
    };
    hs[ChatSession.DENSITY_WRAPPED] = true;
  }

  // ── Provider resolution (stays on coordinator) ───────────────────

  private getActiveProvider(): IProvider | undefined {
    try {
      return this.runtimeContext.provider.getActiveProvider();
    } catch {
      return undefined;
    }
  }

  private lookupProviderByName(
    adapter: AgentRuntimeProviderAdapter,
    desiredProviderName: string,
    compressionProfileName: string,
  ): IProvider | undefined {
    if (typeof adapter.getProviderByName !== 'function') {
      return undefined;
    }
    try {
      const candidate = adapter.getProviderByName(desiredProviderName);
      if (candidate !== undefined) {
        const active = this.getActiveProvider();
        if (active !== undefined && active.name !== desiredProviderName) {
          this.logger.debug(
            () =>
              `[ChatSession] selected provider '${desiredProviderName}' via getProviderByName (active remains '${active.name}') [${compressionProfileName}]`,
          );
        }
        return candidate;
      }
    } catch (error) {
      this.logger.debug(
        () =>
          `[ChatSession] provider lookup skipped (${compressionProfileName}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return undefined;
  }

  resolveProviderForRuntime(compressionProfileName: string): IProvider {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Gemini chat runtime payloads.
    const desiredProviderName = this.runtimeState.provider?.trim();
    const adapter = this.runtimeContext.provider;

    if (desiredProviderName) {
      const candidate = this.lookupProviderByName(
        adapter,
        desiredProviderName,
        compressionProfileName,
      );
      if (candidate) {
        return candidate;
      }
    }

    let provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider configured');
    }

    if (desiredProviderName && provider.name !== desiredProviderName) {
      const previousProviderName = provider.name;
      try {
        adapter.setActiveProvider(desiredProviderName);
        const updatedProvider = adapter.getActiveProvider();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Gemini chat runtime payloads.
        if (updatedProvider != null) {
          provider = updatedProvider;
        }
        this.logger.debug(
          () =>
            `[ChatSession] enforced provider switch to '${desiredProviderName}' (previous '${previousProviderName}') [${compressionProfileName}]`,
        );
      } catch (error) {
        this.logger.debug(
          () =>
            `[ChatSession] provider switch skipped (${compressionProfileName}, read-only context): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return provider;
  }

  private resolveExplicitCompressionProvider(
    profileName: string,
    providerName: string,
    lookupProviderName: string = providerName,
  ): IProvider {
    const adapter = this.runtimeContext.provider;
    const lookupResult = this.lookupProviderByName(
      adapter,
      lookupProviderName,
      `compression.profile:${profileName}`,
    );
    if (lookupResult) {
      return lookupResult;
    }

    const activeProvider = this.getActiveProvider();
    if (
      activeProvider?.name === providerName ||
      activeProvider?.name === lookupProviderName
    ) {
      return activeProvider;
    }

    throw new CompressionProfileNotFoundError(
      profileName,
      `provider '${lookupProviderName}' is not available for compression.profile: provider lookup by name is required when it is not already active`,
    );
  }

  providerSupportsIContent(provider: IProvider | undefined): boolean {
    if (!provider) return false;
    return (
      typeof (provider as { generateChatCompletion?: unknown })
        .generateChatCompletion === 'function'
    );
  }

  private async resolveCompressionProvider(
    profileName: string | undefined,
  ): Promise<CompressionProviderResult> {
    if (!profileName) {
      const provider = this.resolveProviderForRuntime(
        'ChatSession.resolveCompressionProvider.default',
      );
      const runtime = this.runtimeContext.providerRuntime;
      return {
        provider,
        runtime,
        config: runtime.config,
      };
    }

    const config = this.runtimeContext.providerRuntime.config;
    const profileManager = config?.getProfileManager();
    if (!profileManager) {
      throw new CompressionProfileNotFoundError(
        profileName,
        'profile manager is unavailable',
      );
    }

    let profile: Awaited<ReturnType<typeof profileManager.loadProfile>>;
    try {
      profile = await profileManager.loadProfile(profileName);
    } catch (error) {
      throw new CompressionProfileNotFoundError(
        profileName,
        error instanceof Error ? error.message : String(error),
      );
    }

    if (isLoadBalancerProfile(profile)) {
      return this.resolveLoadBalancedCompressionProvider(
        profileName,
        profile,
        config,
        profileManager,
      );
    }

    return this.resolveStandardCompressionProvider(
      profileName,
      profile,
      profileManager,
      config,
    );
  }
  private async resolveLoadBalancedCompressionProvider(
    profileName: string,
    profile: LoadBalancerProfile,
    config: Config | undefined,
    profileManager: NonNullable<ReturnType<Config['getProfileManager']>>,
  ): Promise<CompressionProviderResult> {
    const candidates = await this.buildCompressionLoadBalancerCandidates(
      profileName,
      profile,
      config,
      profileManager,
    );

    const strategy = profile.policy === 'failover' ? 'failover' : 'round-robin';
    const initialIndex =
      this.compressionLoadBalancerRoundRobinIndexes.get(profileName) ?? 0;
    if (strategy === 'round-robin') {
      this.compressionLoadBalancerRoundRobinIndexes.set(
        profileName,
        (initialIndex + 1) % candidates.length,
      );
    }
    const provider = new CompressionLoadBalancingProvider(
      strategy,
      candidates,
      initialIndex,
    );
    const runtimeId = `${this.runtimeContext.providerRuntime.runtimeId}::compression-profile:${profileName}`;
    const settings = new SettingsService();
    settings.setCurrentProfileName(profileName);
    settings.set('activeProvider', 'load-balancer');
    settings.set('model', profile.model || provider.getDefaultModel());
    for (const [key, value] of Object.entries(profile.ephemeralSettings)) {
      if (value !== undefined) {
        settings.set(key, value);
      }
    }
    const metadata = {
      ...(this.runtimeContext.providerRuntime.metadata ?? {}),
      source: 'ChatSession.resolveCompressionProvider',
      compressionProfile: profileName,
      compressionProvider: 'load-balancer',
      runtimeId,
      provider: 'load-balancer',
      model: settings.get('model'),
    };
    const runtime: ProviderRuntimeContext = {
      settingsService: settings,
      config,
      runtimeId,
      metadata,
    };
    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: 'load-balancer',
      ephemeralsSnapshot: this.buildCompressionProfileEphemeralsSnapshot(
        settings,
        'load-balancer',
      ),
      metadata,
      fallbackRuntimeId: runtimeId,
    });
    return {
      provider,
      runtime,
      config,
      invocation,
    };
  }

  private async buildCompressionLoadBalancerCandidates(
    profileName: string,
    profile: LoadBalancerProfile,
    config: Config | undefined,
    profileManager: NonNullable<ReturnType<Config['getProfileManager']>>,
  ): Promise<CompressionLoadBalancerCandidate[]> {
    const candidates: CompressionLoadBalancerCandidate[] = [];
    for (const subProfileName of profile.profiles) {
      const subProfile = await profileManager.loadProfile(subProfileName);
      if (isLoadBalancerProfile(subProfile)) {
        throw new CompressionProfileNotFoundError(
          profileName,
          `load-balanced compression profile references nested load-balanced profile '${subProfileName}'`,
        );
      }
      const candidate = await this.resolveStandardCompressionProvider(
        subProfileName,
        subProfile,
        profileManager,
        config,
        profile.ephemeralSettings as Record<string, unknown>,
      );
      if (!candidate.invocation) {
        throw new CompressionProfileNotFoundError(
          profileName,
          `failed to build invocation context for subprofile '${subProfileName}'`,
        );
      }
      candidates.push({
        profileName: subProfileName,
        provider: candidate.provider,
        runtime: candidate.runtime,
        config: candidate.config,
        resolved: candidate.resolved,
        invocation: candidate.invocation,
      });
    }
    return candidates;
  }

  private async resolveStandardCompressionProvider(
    profileName: string,
    profile: StandardProfile,
    profileManager: NonNullable<ReturnType<Config['getProfileManager']>>,
    config: Config | undefined,
    parentEphemerals: Record<string, unknown> = {},
  ): Promise<CompressionProviderResult> {
    const provider = this.resolveExplicitCompressionProvider(
      profileName,
      profile.provider,
    );
    const profileSettings = new SettingsService();
    await profileManager.applyLoadedProfile(
      profileName,
      profile,
      profileSettings,
    );
    this.applyCompressionProfileParentEphemerals(
      profileSettings,
      profile.provider,
      parentEphemerals,
    );

    this.applyCompressionProfileSettings(profileSettings, profileName, profile);

    const runtimeId = `${this.runtimeContext.providerRuntime.runtimeId}::compression-profile:${profileName}`;
    const metadata = {
      ...(this.runtimeContext.providerRuntime.metadata ?? {}),
      source: 'ChatSession.resolveCompressionProvider',
      compressionProfile: profileName,
      compressionProvider: profile.provider,
      runtimeId,
      provider: profile.provider,
      model: profile.model,
    };
    const runtime: ProviderRuntimeContext = {
      settingsService: profileSettings,
      config,
      runtimeId,
      metadata,
    };
    const resolved = await this.buildCompressionProfileResolvedOptions(
      profileSettings,
      profile,
    );
    const invocation = createRuntimeInvocationContext({
      runtime,
      settings: profileSettings,
      providerName: profile.provider,
      ephemeralsSnapshot: this.buildCompressionProfileEphemeralsSnapshot(
        profileSettings,
        profile.provider,
      ),
      metadata,
      fallbackRuntimeId: runtimeId,
    });

    return {
      provider,
      runtime,
      config,
      resolved,
      invocation,
    };
  }

  private applyCompressionProfileSettings(
    profileSettings: SettingsService,
    profileName: string,
    profile: StandardProfile,
  ): void {
    const provider = profile.provider;
    const ephemerals = profile.ephemeralSettings as Record<string, unknown>;

    profileSettings.setCurrentProfileName(profileName);
    profileSettings.set('activeProvider', provider);
    profileSettings.set('model', profile.model);
    profileSettings.setProviderSetting(provider, 'enabled', true);
    profileSettings.setProviderSetting(provider, 'model', profile.model);

    for (const [key, value] of Object.entries(ephemerals)) {
      if (value !== undefined) {
        profileSettings.set(key, value);
        profileSettings.setProviderSetting(provider, key, value);
      }
    }

    this.applyCompressionProfileAuthSettings(
      profileSettings,
      provider,
      ephemerals,
    );
    this.applyCompressionProfileModelParams(
      profileSettings,
      provider,
      profile.modelParams,
    );

    if (profile.auth) {
      profileSettings.set('auth.type', profile.auth.type);
      profileSettings.setProviderSetting(provider, 'auth', profile.auth);
      if (profile.auth.buckets) {
        profileSettings.set('auth.buckets', profile.auth.buckets);
      }
    }
  }

  private applyCompressionProfileAuthSettings(
    profileSettings: SettingsService,
    provider: string,
    ephemerals: Record<string, unknown>,
  ): void {
    this.copyProfileSettingAliases(profileSettings, provider, ephemerals, [
      { sourceKey: 'auth-key', globalKey: 'auth-key', providerKey: 'auth-key' },
      { sourceKey: 'auth-key', providerKey: 'apiKey' },
      { sourceKey: 'apiKey', globalKey: 'auth-key', providerKey: 'apiKey' },
      { sourceKey: 'apiKey', providerKey: 'auth-key' },
      {
        sourceKey: 'auth-keyfile',
        globalKey: 'auth-keyfile',
        providerKey: 'auth-keyfile',
      },
      { sourceKey: 'auth-keyfile', providerKey: 'apiKeyfile' },
      { sourceKey: 'apiKeyfile', providerKey: 'apiKeyfile' },
      {
        sourceKey: 'auth-key-name',
        globalKey: 'auth-key-name',
        providerKey: 'auth-key-name',
      },
    ]);

    for (const key of ['base-url', 'sandbox-base-url', 'api-version']) {
      const value = ephemerals[key];
      if (value !== undefined) {
        profileSettings.setProviderSetting(provider, key, value);
      }
    }
  }

  private copyProfileSettingAliases(
    profileSettings: SettingsService,
    provider: string,
    ephemerals: Record<string, unknown>,
    aliases: ReadonlyArray<{
      sourceKey: string;
      globalKey?: string;
      providerKey: string;
    }>,
  ): void {
    for (const alias of aliases) {
      const value = ephemerals[alias.sourceKey];
      if (value === undefined) {
        continue;
      }
      if (alias.globalKey) {
        profileSettings.set(alias.globalKey, value);
      }
      profileSettings.setProviderSetting(provider, alias.providerKey, value);
    }
  }

  private applyCompressionProfileModelParams(
    profileSettings: SettingsService,
    provider: string,
    modelParams: StandardProfile['modelParams'],
  ): void {
    for (const [key, value] of Object.entries(modelParams)) {
      if (value !== undefined) {
        profileSettings.setProviderSetting(provider, key, value);
      }
    }
    const aliases: Record<string, unknown> = {
      temperature: modelParams.temperature,
      maxTokens: modelParams.max_tokens,
      topP: modelParams.top_p,
      topK: modelParams.top_k,
      presencePenalty: modelParams.presence_penalty,
      frequencyPenalty: modelParams.frequency_penalty,
    };
    for (const [key, value] of Object.entries(aliases)) {
      if (value !== undefined) {
        profileSettings.setProviderSetting(provider, key, value);
      }
    }
  }

  private applyCompressionProfileParentEphemerals(
    profileSettings: SettingsService,
    provider: string,
    parentEphemerals: Record<string, unknown>,
  ): void {
    for (const [key, value] of Object.entries(parentEphemerals)) {
      if (value !== undefined && profileSettings.get(key) === undefined) {
        profileSettings.set(key, value);
      }
    }
    for (const key of ['custom-headers', 'api-version', 'sandbox-base-url']) {
      const value = parentEphemerals[key];
      if (value !== undefined) {
        profileSettings.setProviderSetting(provider, key, value);
      }
    }
  }

  private resolveProviderBaseUrl(_provider: IProvider): string | undefined {
    return this.runtimeState.baseUrl;
  }

  private buildProviderRuntime(
    source: string,
    metadata: Record<string, unknown> = {},
  ): ProviderRuntimeContext {
    const baseRuntime = this.runtimeContext.providerRuntime;
    const runtimeId =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Gemini chat runtime payloads.
      baseRuntime.runtimeId ?? this.runtimeState.runtimeId ?? 'chatSession';

    return {
      ...baseRuntime,
      runtimeId,
      metadata: {
        ...(baseRuntime.metadata ?? {}),
        source,
        ...metadata,
      },
    };
  }

  private async buildCompressionProfileResolvedOptions(
    profileSettings: SettingsService,
    profile: StandardProfile,
  ): Promise<RuntimeGenerateChatOptions['resolved']> {
    const providerSettings = profileSettings.getProviderSettings(
      profile.provider,
    );
    const baseURL =
      typeof providerSettings['base-url'] === 'string'
        ? providerSettings['base-url']
        : undefined;
    const temperature =
      typeof providerSettings.temperature === 'number'
        ? providerSettings.temperature
        : undefined;
    const maxTokens =
      typeof providerSettings.maxTokens === 'number'
        ? providerSettings.maxTokens
        : undefined;
    return {
      model: profile.model,
      ...(baseURL ? { baseURL } : {}),
      ...(await this.resolveCompressionProfileAuthToken(
        profileSettings,
        profile.provider,
      )),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
  }

  private async resolveCompressionProfileAuthToken(
    profileSettings: SettingsService,
    provider: string,
  ): Promise<{ authToken: string } | Record<string, never>> {
    const providerSettings = profileSettings.getProviderSettings(provider);
    const directAuth = this.getStringSettingFromValues([
      providerSettings['auth-key'],
      providerSettings.apiKey,
      profileSettings.get('auth-key'),
    ]);
    if (directAuth) {
      return { authToken: directAuth };
    }

    const keyName = this.getStringSettingFromValues([
      providerSettings['auth-key-name'],
      profileSettings.get('auth-key-name'),
    ]);
    if (keyName) {
      const token = await getProviderKeyStorage().getKey(keyName);
      if (token) {
        return { authToken: token };
      }
    }

    const keyFile = this.getStringSettingFromValues([
      providerSettings['auth-keyfile'],
      providerSettings.apiKeyfile,
      profileSettings.get('auth-keyfile'),
    ]);
    if (keyFile) {
      const token = (
        await fs.readFile(this.expandProfilePath(keyFile), 'utf8')
      ).trim();
      if (token) {
        return { authToken: token };
      }
    }

    return {};
  }

  private getStringSettingFromValues(
    values: readonly unknown[],
  ): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }
    return undefined;
  }

  private expandProfilePath(value: string): string {
    if (value.startsWith('~/')) {
      return path.join(os.homedir(), value.slice(2));
    }
    return value;
  }

  private buildCompressionProfileEphemeralsSnapshot(
    profileSettings: SettingsService,
    provider: string,
  ): Record<string, unknown> {
    return {
      ...profileSettings.getAllGlobalSettings(),
      [provider]: { ...profileSettings.getProviderSettings(provider) },
    };
  }

  // ── Position matcher (used by multiple modules) ──────────────────

  private _makePositionMatcher():
    | (() => { historyId: string; toolName?: string })
    | undefined {
    return this.conversationManager.makePositionMatcher();
  }

  // ── Public API — thin delegation ─────────────────────────────────

  async sendMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    return this.turnProcessor.sendMessage(params, prompt_id);
  }

  async sendMessageStream(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>> {
    return this.turnProcessor.sendMessageStream(params, prompt_id);
  }

  async generateDirectMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    return this.directMessageProcessor.generateDirectMessage(params, prompt_id);
  }

  async waitForIdle(): Promise<void> {
    return this.turnProcessor.waitForIdle();
  }

  setSystemInstruction(sysInstr: string) {
    this.generationConfig.systemInstruction = sysInstr;
  }

  getHistoryService(): HistoryService {
    return this.historyService;
  }

  getToolsView(): ToolRegistryView {
    return this.runtimeContext.tools;
  }

  setTools(tools: Tool[]): void {
    this.generationConfig.tools = tools;
  }

  clearTools(): void {
    this.generationConfig.tools = undefined;
  }

  getHistory(curated: boolean = false): Content[] {
    return this.conversationManager.getHistory(curated);
  }

  clearHistory(): void {
    this.conversationManager.clearHistory();
  }

  addHistory(content: Content): void {
    this.conversationManager.addHistory(content);
  }

  setHistory(history: Content[]): void {
    this.conversationManager.setHistory(history);
  }

  setActiveTodosProvider(provider: () => Promise<string | undefined>): void {
    this.compressionHandler.setActiveTodosProvider(provider);
  }

  async performCompression(
    prompt_id: string,
    options?: { bypassCooldown?: boolean },
  ): Promise<PerformCompressionResult> {
    return this.compressionHandler.performCompression(prompt_id, options);
  }

  wasRecentlyCompressed(): boolean {
    return this.compressionHandler.wasRecentlyCompressed();
  }

  getLastPromptTokenCount(): number {
    return this.compressionHandler.lastPromptTokenCount ?? 0;
  }

  recordCompletedToolCalls(
    _model: string,
    _toolCalls: CompletedToolCall[],
  ): void {
    // No-op stub for compatibility
  }

  // Public conversion methods — delegated to standalone functions
  convertPartListUnionToIContent(input: PartListUnion): IContent {
    return convertPartListUnionToIContent(input);
  }

  convertIContentToResponse(input: IContent): GenerateContentResponse {
    return convertIContentToResponse(input);
  }

  async estimatePendingTokens(contents: IContent[]): Promise<number> {
    return this.turnProcessor.estimatePendingTokens(contents);
  }

  // ── Internal compat pass-throughs (used by tests via `as never` casts) ──

  get densityDirty(): boolean {
    return this.compressionHandler.densityDirty;
  }

  set densityDirty(value: boolean) {
    this.compressionHandler.densityDirty = value;
  }

  get _suppressDensityDirty(): boolean {
    return this.compressionHandler._suppressDensityDirty;
  }

  set _suppressDensityDirty(value: boolean) {
    this.compressionHandler._suppressDensityDirty = value;
  }

  async ensureDensityOptimized(): Promise<void> {
    return this.compressionHandler.ensureDensityOptimized();
  }

  async ensureCompressionBeforeSend(
    promptId: string,
    pendingTokens: number,
    source: 'send' | 'stream',
    trigger: 'manual' | 'auto' = 'auto',
  ): Promise<void> {
    return this.compressionHandler.ensureCompressionBeforeSend(
      promptId,
      pendingTokens,
      source,
      trigger,
    );
  }

  async enforceContextWindow(
    pendingTokens: number,
    promptId: string,
  ): Promise<void> {
    return this.compressionHandler.enforceContextWindow(
      pendingTokens,
      promptId,
    );
  }

  shouldCompress(pendingTokens?: number): boolean {
    return this.compressionHandler.shouldCompress(pendingTokens);
  }

  /**
   * Returns the Config instance from the provider runtime.
   * Used by Turn and other consumers to access ephemeral settings.
   */
  getConfig(): Config | undefined {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Gemini chat runtime payloads.
    return this.runtimeContext.providerRuntime?.config;
  }
}
