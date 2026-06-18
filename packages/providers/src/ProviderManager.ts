/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import { type IProvider, type GenerateChatOptions } from './IProvider.js';
import { type IProviderManager } from './IProviderManager.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { HydratedModel } from '@vybestack/llxprt-code-core/models/hydration.js';
import { LoggingProviderWrapper } from './LoggingProviderWrapper.js';
import { RetryOrchestrator } from './RetryOrchestrator.js';
import {
  logProviderSwitch,
  logProviderCapability,
} from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import {
  ProviderSwitchEvent,
  ProviderCapabilityEvent,
} from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { ProviderCapabilities, ProviderComparison } from './types.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  getActiveProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { MissingProviderRuntimeError } from './errors.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  TokenUsageTracker,
  type CacheStatistics,
  type SessionTokenUsage,
} from './tokenUsageTracker.js';
import { ProviderCapabilitiesService } from './providerCapabilitiesService.js';
import {
  buildEphemeralsSnapshot,
  normalizeRuntimeInputs,
} from './runtimeNormalizer.js';
import { resolveAvailableModels } from './modelResolver.js';

const logger = new DebugLogger('llxprt:provider:manager');

function asSettingsService(
  settingsService: ProviderRuntimeContext['settingsService'],
): SettingsService {
  return settingsService as SettingsService;
}

interface ProviderManagerInit {
  runtime?: ProviderRuntimeContext;
  config?: Config;
  settingsService?: SettingsService;
}

/**
 * Type guard: distinguish ProviderRuntimeContext from ProviderManagerInit.
 * A ProviderRuntimeContext has settingsService plus either runtimeId or metadata.
 */
function isRuntimeContext(
  init: ProviderManagerInit | ProviderRuntimeContext,
): init is ProviderRuntimeContext {
  return (
    'settingsService' in init && ('runtimeId' in init || 'metadata' in init)
  );
}

/**
 * Check whether a settings value is effectively absent (null, undefined, empty,
 * false, 0, or NaN).
 */
function isBlankValue(value: unknown): boolean {
  if (value == null || value === '' || value === false || value === 0) {
    return true;
  }

  return typeof value === 'number' && Number.isNaN(value);
}

export class ProviderManager implements IProviderManager {
  private providers: Map<string, IProvider>;
  private serverToolsProvider: IProvider | null;
  private config?: Config;
  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P05
   * @requirement REQ-SP-001
   * @pseudocode provider-invocation.md lines 8-15
   */
  private settingsService: SettingsService;
  private runtime?: ProviderRuntimeContext;
  private providerCapabilities: Map<string, ProviderCapabilities> = new Map();
  private tokenUsageTracker: TokenUsageTracker = new TokenUsageTracker();
  private capabilitiesService: ProviderCapabilitiesService;

  constructor(init?: ProviderManagerInit | ProviderRuntimeContext) {
    const resolved = this.resolveInit(init);
    this.providers = new Map<string, IProvider>();
    this.serverToolsProvider = null;
    this.settingsService = resolved.settingsService;
    this.config = resolved.config ?? this.config;
    this.runtime = resolved.runtime;
    this.capabilitiesService = new ProviderCapabilitiesService(
      this.providerCapabilities,
    );
  }

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P05
   * @requirement REQ-SP-001
   * @pseudocode provider-invocation.md lines 8-15
   * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
   * @requirement:REQ-SP2-002
   * @pseudocode multi-runtime-baseline.md lines 3-4
   */
  private resolveInit(init?: ProviderManagerInit | ProviderRuntimeContext): {
    settingsService: SettingsService;
    config?: Config;
    runtime?: ProviderRuntimeContext;
  } {
    let fallback: ProviderRuntimeContext | null = null;
    const ensureFallback = (): ProviderRuntimeContext => {
      fallback ??= getActiveProviderRuntimeContext();
      return fallback;
    };

    if (!init) {
      const resolved = ensureFallback();
      return {
        settingsService: asSettingsService(resolved.settingsService),
        config: resolved.config,
        runtime: resolved,
      };
    }

    if (isRuntimeContext(init)) {
      const context = init;
      return {
        settingsService: asSettingsService(context.settingsService),
        config: context.config,
        runtime: context,
      };
    }

    const initObj = init;
    const runtime = initObj.runtime;
    let settingsService =
      initObj.settingsService ??
      (runtime?.settingsService
        ? asSettingsService(runtime.settingsService)
        : null);
    let config: Config | undefined =
      initObj.config ?? runtime?.config ?? undefined;

    if (!settingsService || !config) {
      const resolved = ensureFallback();
      settingsService =
        settingsService ?? asSettingsService(resolved.settingsService);
      config = config ?? resolved.config;
      return {
        settingsService,
        config,
        runtime: runtime ?? resolved,
      };
    }

    return {
      settingsService,
      config,
      runtime,
    };
  }

  buildEphemeralsSnapshot(
    settingsService: SettingsService,
    providerName: string,
  ): Record<string, unknown> {
    return buildEphemeralsSnapshot(settingsService, providerName);
  }

  setConfig(config: Config): void {
    const hadConfig = Boolean(this.config);
    const oldLoggingEnabled =
      this.config?.getConversationLoggingEnabled() ?? false;
    const newLoggingEnabled = config.getConversationLoggingEnabled();

    this.config = config;
    this.runtime = this.runtime
      ? { ...this.runtime, config }
      : { settingsService: this.settingsService, config };

    // Always ensure providers are wrapped once config becomes available
    if (!hadConfig || oldLoggingEnabled !== newLoggingEnabled) {
      logger.debug(
        () =>
          `[provider-manager] Wrapping providers (hadConfig=${hadConfig}, loggingChanged=${oldLoggingEnabled !== newLoggingEnabled})`,
      );
      this.updateProviderWrapping();
    }
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @plan PLAN-20260128issue808
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 3-5
   */
  private updateProviderWrapping(): void {
    logger.debug(
      () =>
        `[provider-manager] updateProviderWrapping invoked (providerCount=${this.providers.size}, hasConfig=${Boolean(this.config)})`,
    );
    // Re-wrap all providers (ALWAYS wrap for token tracking)
    const providers = new Map(this.providers);

    for (const [name, provider] of providers) {
      // Fully unwrap to get the base provider
      let baseProvider = provider;
      while (
        'wrappedProvider' in baseProvider &&
        baseProvider.wrappedProvider !== undefined &&
        baseProvider.wrappedProvider !== null
      ) {
        baseProvider = baseProvider.wrappedProvider as IProvider;
      }

      this.syncProviderRuntime(baseProvider);

      // Apply wrapping order (inner to outer):
      // 1. RetryOrchestrator (retry, backoff, bucket failover)
      // 2. LoggingProviderWrapper (token tracking, telemetry)
      let finalProvider: IProvider = baseProvider;

      // First wrap with RetryOrchestrator
      finalProvider = new RetryOrchestrator(finalProvider);

      // Then wrap with LoggingProviderWrapper if config is available
      if (this.config) {
        finalProvider = new LoggingProviderWrapper(finalProvider, this.config);
      }

      this.syncProviderRuntime(finalProvider);
      this.providers.set(name, finalProvider);

      // Update server tools provider reference if needed
      if (this.serverToolsProvider && this.serverToolsProvider.name === name) {
        this.serverToolsProvider = finalProvider;
      }
    }
  }

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P05
   * @requirement REQ-SP-001
   * @pseudocode provider-invocation.md lines 8-15
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement:REQ-SP4-001
   * @pseudocode provider-runtime-handling.md lines 10-15
   */
  private syncProviderRuntime(provider: IProvider): void {
    const runtimeAware = provider as IProvider & {
      setRuntimeSettingsService?: (settingsService: SettingsService) => void;
      setConfig?: (config: Config) => void;
      setRuntimeContextResolver?: (
        resolver: () => ProviderRuntimeContext,
      ) => void;
      setOptionsNormalizer?: (
        normalizer: (
          options: GenerateChatOptions,
          providerName: string,
        ) => GenerateChatOptions,
      ) => void;
    };
    runtimeAware.setRuntimeSettingsService?.(this.settingsService);
    if (this.config && runtimeAware.setConfig) {
      runtimeAware.setConfig(this.config);
    }
    if (
      runtimeAware.setRuntimeContextResolver &&
      typeof runtimeAware.setRuntimeContextResolver === 'function'
    ) {
      runtimeAware.setRuntimeContextResolver(() =>
        this.snapshotRuntimeContext('ProviderManager.syncProviderRuntime'),
      );
    }
    if (
      runtimeAware.setOptionsNormalizer &&
      typeof runtimeAware.setOptionsNormalizer === 'function'
    ) {
      runtimeAware.setOptionsNormalizer((options, providerName) =>
        this.normalizeRuntimeInputs(options, providerName),
      );
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement:REQ-SP4-001
   * @pseudocode provider-runtime-handling.md lines 10-15
   */
  private snapshotRuntimeContext(source: string): ProviderRuntimeContext {
    const baseRuntime: ProviderRuntimeContext = this.runtime ?? {
      settingsService: this.settingsService,
      config: this.config,
      runtimeId: 'provider-manager.default-runtime',
      metadata: { source: 'ProviderManager', requirement: 'REQ-SP4-001' },
    };

    if (!this.runtime) {
      this.runtime = baseRuntime;
    } else if (!this.runtime.config && baseRuntime.config) {
      this.runtime = { ...this.runtime, config: baseRuntime.config };
    }

    const settingsService = (
      baseRuntime as { settingsService?: SettingsService | null }
    ).settingsService;
    if (settingsService === null || settingsService === undefined) {
      throw new MissingProviderRuntimeError({
        providerKey: 'ProviderManager',
        missingFields: ['settings'],
        stage: source,
        metadata: {
          requirement: 'REQ-SP4-001',
          hint: 'ProviderManager requires a SettingsService to construct runtime contexts.',
        },
      });
    }

    const config = baseRuntime.config ?? this.config;
    if (!config) {
      throw new MissingProviderRuntimeError({
        providerKey: 'ProviderManager',
        missingFields: ['config'],
        stage: source,
        metadata: {
          requirement: 'REQ-SP4-001',
          hint: 'Call ProviderManager.setConfig before invoking providers.',
        },
      });
    }

    const baseMetadata = baseRuntime.metadata ?? {};
    const callMetadata: Record<string, unknown> = {
      ...baseMetadata,
      source,
      requirement: 'REQ-SP4-001',
      generatedAt: new Date().toISOString(),
    };

    const baseId = baseRuntime.runtimeId;
    const callRuntimeId =
      typeof baseId === 'string' && baseId.trim() !== ''
        ? `${baseId}:${Math.random().toString(36).slice(2, 10)}`
        : `provider-manager:${source}:${Date.now().toString(36)}`;

    return {
      settingsService,
      config,
      runtimeId: callRuntimeId,
      metadata: callMetadata,
    };
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * @requirement:REQ-SP4-003
   * @requirement:REQ-SP4-004
   * @requirement:REQ-SP4-005
   * @pseudocode provider-runtime-handling.md lines 10-16
   *
   * Normalize runtime inputs per call - no stored settings/config fallbacks.
   */
  normalizeRuntimeInputs(
    rawOptions: GenerateChatOptions,
    providerName?: string,
  ): GenerateChatOptions {
    return normalizeRuntimeInputs(
      rawOptions,
      {
        getActiveProviderName: () => this.getActiveProviderName(),
        getProvider: (name) => this.providers.get(name),
      },
      providerName,
    );
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @plan PLAN-20260128issue808
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 3-5
   */
  registerProvider(provider: IProvider): void {
    this.syncProviderRuntime(provider);

    // Wrapping order (inner to outer):
    // 1. Raw provider (fast-fail on errors)
    // 2. RetryOrchestrator (retry, backoff, bucket failover)
    // 3. LoggingProviderWrapper (token tracking, telemetry)

    let finalProvider: IProvider = provider;

    // First wrap with RetryOrchestrator for centralized retry/failover
    finalProvider = new RetryOrchestrator(finalProvider, {
      // Config will be read from ephemeral settings at call time
      // Default values will be used if not provided
    });

    // Then wrap with LoggingProviderWrapper for token tracking
    if (this.config) {
      finalProvider = new LoggingProviderWrapper(finalProvider, this.config);
    }

    this.syncProviderRuntime(finalProvider);

    this.providers.set(provider.name, finalProvider);

    // Capture provider capabilities
    const capabilities = this.capabilitiesService.captureProviderCapabilities(
      provider,
      this.settingsService,
      this.config,
    );
    this.providerCapabilities.set(provider.name, capabilities);

    // Log provider capability information if logging enabled
    if (this.config?.getConversationLoggingEnabled() === true) {
      const context = this.capabilitiesService.createProviderContext(
        provider,
        capabilities,
        this.settingsService,
        this.config,
      );
      logProviderCapability(
        this.config,
        new ProviderCapabilityEvent(provider.name, capabilities, context),
      );
    }

    // If this is the default provider and no provider is active, set it as active
    const currentActiveProvider = this.settingsService.get('activeProvider');
    if (provider.isDefault === true && isBlankValue(currentActiveProvider)) {
      this.settingsService.set('activeProvider', provider.name);
    }

    // If registering Gemini and we don't have a serverToolsProvider, use it
    if (provider.name === 'gemini' && !this.serverToolsProvider) {
      this.serverToolsProvider = provider;
    }

    // If Gemini is the active provider, it should also be the serverToolsProvider
    if (provider.name === 'gemini' && currentActiveProvider === 'gemini') {
      this.serverToolsProvider = provider;
    }
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 3-5
   */
  setActiveProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error('Provider not found');
    }

    // Store reference to the current active provider before switching
    const previousProviderName =
      (this.settingsService.get('activeProvider') as string) || '';

    // Only clear state from the provider we're switching FROM
    // BUT never clear the serverToolsProvider's state
    if (previousProviderName && previousProviderName !== name) {
      const previousProvider = this.providers.get(previousProviderName);
      if (
        previousProvider &&
        previousProvider !== this.serverToolsProvider &&
        'clearState' in previousProvider
      ) {
        const candidate = previousProvider as { clearState?: () => void };
        candidate.clearState?.();
      }
    }

    // Log provider switch if conversation logging enabled
    if (
      this.config?.getConversationLoggingEnabled() === true &&
      previousProviderName &&
      previousProviderName !== name
    ) {
      logProviderSwitch(
        this.config,
        new ProviderSwitchEvent(
          previousProviderName,
          name,
          this.generateConversationId(),
          this.capabilitiesService.isContextPreserved(
            previousProviderName,
            name,
          ),
        ),
      );
    }

    // Update SettingsService as the single source of truth
    this.settingsService.set('activeProvider', name);

    // If switching to Gemini, use it as both active and serverTools provider
    // BUT only if we don't already have a Gemini serverToolsProvider with auth state
    if (name === 'gemini') {
      // Only replace serverToolsProvider if it's not already Gemini or if it's null
      if (
        !this.serverToolsProvider ||
        this.serverToolsProvider.name !== 'gemini'
      ) {
        this.serverToolsProvider = this.providers.get(name) ?? null;
      }
    }
    // If switching away from Gemini but serverToolsProvider is not set,
    // configure a Gemini provider for serverTools if available
    else if (!this.serverToolsProvider && this.providers.has('gemini')) {
      this.serverToolsProvider = this.providers.get('gemini') ?? null;
    }
  }

  clearActiveProvider(): void {
    this.settingsService.set('activeProvider', '');
  }

  getActiveProvider(): IProvider {
    const activeProviderName =
      (this.settingsService.get('activeProvider') as string) || '';

    let resolvedName = activeProviderName;

    if (!resolvedName) {
      const preferredFromConfig = this.config?.getProvider();
      if (preferredFromConfig && this.providers.has(preferredFromConfig)) {
        resolvedName = preferredFromConfig;
      } else if (this.providers.has('openai')) {
        resolvedName = 'openai';
      } else {
        const firstProvider = this.providers.keys().next();
        resolvedName = firstProvider.done === true ? '' : firstProvider.value;
      }

      if (resolvedName) {
        try {
          this.setActiveProvider(resolvedName);
        } catch (error) {
          throw new Error(
            `Unable to set default provider '${resolvedName}': ${String(error)}`,
          );
        }
      }
    }

    if (!resolvedName) {
      throw new Error('No active provider set');
    }

    const provider = this.providers.get(resolvedName);
    if (!provider) {
      throw new Error('Active provider not found');
    }
    return provider;
  }

  async getAvailableModels(providerName?: string): Promise<HydratedModel[]> {
    let provider: IProvider | undefined;

    if (providerName) {
      provider = this.providers.get(providerName);
      if (!provider) {
        throw new Error(`Provider '${providerName}' not found`);
      }
    } else {
      provider = this.getActiveProvider();
    }

    return resolveAvailableModels(provider);
  }

  listProviders(): string[] {
    const names = Array.from(this.providers.keys());
    const priorityOrder = ['anthropic', 'gemini', 'openai', 'openai-responses'];
    const prioritized = priorityOrder.filter((name) => names.includes(name));
    const remaining = names
      .filter((name) => !priorityOrder.includes(name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return [...prioritized, ...remaining];
  }

  /**
   * Get a provider by name (for OAuth manager)
   */
  getProviderByName(name: string): IProvider | undefined {
    return this.providers.get(name);
  }

  getActiveProviderName(): string {
    return (this.settingsService.get('activeProvider') as string) || '';
  }

  hasActiveProvider(): boolean {
    const activeProviderName =
      (this.settingsService.get('activeProvider') as string) || '';
    return activeProviderName !== '' && this.providers.has(activeProviderName);
  }

  getServerToolsProvider(): IProvider | null {
    // If we have a configured serverToolsProvider, return it
    if (this.serverToolsProvider) {
      return this.serverToolsProvider;
    }

    // Otherwise, try to get Gemini if available
    const geminiProvider = this.providers.get('gemini');
    if (geminiProvider) {
      this.serverToolsProvider = geminiProvider;
      return geminiProvider;
    }

    return null;
  }

  setServerToolsProvider(provider: IProvider | null): void {
    this.serverToolsProvider = provider;
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Accumulate token usage for the current session
   */
  accumulateSessionTokens(
    providerName: string,
    usage: {
      input: number;
      output: number;
      cache: number;
      tool: number;
      thought: number;
      cacheReads?: number;
      cacheWrites?: number | null;
    },
  ): void {
    this.tokenUsageTracker.accumulateSessionTokens(providerName, usage);
  }

  /**
   * Reset session token usage counters
   */
  resetSessionTokenUsage(): void {
    this.tokenUsageTracker.resetSessionTokenUsage();
  }

  /**
   * Get current session token usage
   */
  getSessionTokenUsage(): SessionTokenUsage {
    return this.tokenUsageTracker.getSessionTokenUsage();
  }

  /**
   * Track cache read/write statistics from a request
   * @param cacheReads - Number of tokens read from cache
   * @param cacheWrites - Number of tokens written to cache, or null if provider doesn't report this
   */
  trackCacheUsage(cacheReads: number, cacheWrites: number | null): void {
    this.tokenUsageTracker.trackCacheUsage(cacheReads, cacheWrites);
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics(): CacheStatistics {
    return this.tokenUsageTracker.getCacheStatistics();
  }

  /**
   * Get performance metrics for the active provider
   * @plan PLAN-20250909-TOKTRACK
   */
  getProviderMetrics(providerName?: string) {
    const name = providerName ?? this.getActiveProviderName();
    if (!name) return null;

    const provider = this.providers.get(name);
    if (!provider) return null;

    // Check if provider has getPerformanceMetrics method (LoggingProviderWrapper)
    if (
      'getPerformanceMetrics' in provider &&
      typeof provider.getPerformanceMetrics === 'function'
    ) {
      return provider.getPerformanceMetrics();
    }

    // Return default metrics if provider doesn't support performance tracking
    return {
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      totalTokens: 0,
      totalRequests: 0,
    };
  }

  resetConversationContext(): void {
    // Conversation ID is now managed by the logging system
  }

  getProviderCapabilities(
    providerName?: string,
  ): ProviderCapabilities | undefined {
    const name =
      providerName ?? (this.settingsService.get('activeProvider') as string);
    return this.providerCapabilities.get(name);
  }

  /* @plan:PLAN-20251023-STATELESS-HARDENING.P06 */
  /* @requirement:REQ-SP4-004 */
  prepareStatelessProviderInvocation(context?: ProviderRuntimeContext): void {
    const stage = 'ProviderManager.prepareStatelessProviderInvocation';
    const runtimeContext = context ?? this.runtime;

    if (!runtimeContext) {
      throw new MissingProviderRuntimeError({
        providerKey: 'ProviderManager',
        missingFields: ['runtime'],
        requirement: 'REQ-SP4-004',
        stage,
        metadata: {
          hint: 'Register CLI runtime context before invoking providers.',
        },
      });
    }

    const invocationSettingsService = (
      runtimeContext as { settingsService?: SettingsService | null }
    ).settingsService;
    if (
      invocationSettingsService === null ||
      invocationSettingsService === undefined
    ) {
      throw new MissingProviderRuntimeError({
        providerKey: 'ProviderManager',
        missingFields: ['settings'],
        requirement: 'REQ-SP4-004',
        stage,
        metadata: {
          runtimeId: runtimeContext.runtimeId,
          hint: 'ProviderManager requires a SettingsService for stateless invocation.',
        },
      });
    }

    const resolvedConfig = runtimeContext.config ?? this.config;
    if (!resolvedConfig) {
      throw new MissingProviderRuntimeError({
        providerKey: 'ProviderManager',
        missingFields: ['config'],
        requirement: 'REQ-SP4-004',
        stage,
        metadata: {
          runtimeId: runtimeContext.runtimeId,
          hint: 'ProviderManager requires Config before stateless invocation.',
        },
      });
    }

    const statelessMetadata: Record<string, unknown> = {
      ...(runtimeContext.metadata ?? {}),
      statelessHardening: 'strict',
      statelessProviderMode: 'strict',
      statelessGuards: true,
      statelessMode: 'strict',
      requirement: 'REQ-SP4-004',
      source: stage,
      preparedAt: new Date().toISOString(),
    };

    this.runtime = {
      ...runtimeContext,
      settingsService: invocationSettingsService,
      config: resolvedConfig,
      metadata: statelessMetadata,
    };
    this.settingsService = asSettingsService(runtimeContext.settingsService);
    this.config = resolvedConfig;

    for (const provider of this.providers.values()) {
      this.attachStatelessRuntimeMetadata(provider, statelessMetadata);
    }
  }

  private attachStatelessRuntimeMetadata(
    provider: IProvider,
    metadata: Record<string, unknown>,
  ): void {
    const statelessAware = provider as IProvider & {
      attachStatelessRuntimeMetadata?: (
        metadata: Record<string, unknown>,
      ) => void;
      wrappedProvider?: IProvider;
    };

    statelessAware.attachStatelessRuntimeMetadata?.(metadata);

    if (statelessAware.wrappedProvider) {
      this.attachStatelessRuntimeMetadata(
        statelessAware.wrappedProvider,
        metadata,
      );
    }
  }

  compareProviders(provider1: string, provider2: string): ProviderComparison {
    return this.capabilitiesService.compareProviders(provider1, provider2);
  }
}
