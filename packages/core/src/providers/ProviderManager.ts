/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import { type IProvider, type GenerateChatOptions } from './IProvider.js';
import { type IProviderManager } from './IProviderManager.js';
import { Config } from '../config/config.js';
import {
  hydrateModelsWithRegistry,
  getModelsDevProviderIds,
  type HydratedModel,
} from '../models/hydration.js';
import {
  initializeModelRegistry,
  getModelRegistry,
} from '../models/registry.js';
import { LoggingProviderWrapper } from './LoggingProviderWrapper.js';
import { RetryOrchestrator } from './RetryOrchestrator.js';
import {
  logProviderSwitch,
  logProviderCapability,
} from '../telemetry/loggers.js';
import {
  ProviderSwitchEvent,
  ProviderCapabilityEvent,
} from '../telemetry/types.js';
import type {
  ProviderCapabilities,
  ProviderContext,
  ProviderComparison,
} from './types.js';
import type { SettingsService } from '../settings/SettingsService.js';
import {
  getActiveProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import {
  MissingProviderRuntimeError,
  ProviderRuntimeNormalizationError,
} from './errors.js';
import { createRuntimeInvocationContext } from '../runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import { PROVIDER_CONFIG_KEYS } from './providerConfigKeys.js';

const PROVIDER_CAPABILITY_HINTS: Record<
  string,
  Partial<ProviderCapabilities>
> = {
  gemini: {
    hasModelSelection: true,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: false,
  },
  openai: {
    hasModelSelection: true,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: true,
  },
  'openai-responses': {
    hasModelSelection: false,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: true,
  },
  anthropic: {
    hasModelSelection: true,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: true,
  },
  openaivercel: {
    hasModelSelection: true,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: true,
  },
};

const logger = new DebugLogger('llxprt:provider:manager');

interface ProviderManagerInit {
  runtime?: ProviderRuntimeContext;
  config?: Config;
  settingsService?: SettingsService;
}

export interface CacheStatistics {
  totalCacheReads: number;
  /** null means provider doesn't report cache writes; 0 means explicitly reported as zero */
  totalCacheWrites: number | null;
  requestsWithCacheHits: number;
  requestsWithCacheWrites: number;
  hitRate: number;
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
  private sessionTokenUsage: {
    input: number;
    output: number;
    cache: number;
    tool: number;
    thought: number;
    total: number;
  } = {
    input: 0,
    output: 0,
    cache: 0,
    tool: 0,
    thought: 0,
    total: 0,
  };
  private cacheStats: CacheStatistics = {
    totalCacheReads: 0,
    totalCacheWrites: null,
    requestsWithCacheHits: 0,
    requestsWithCacheWrites: 0,
    hitRate: 0,
  };

  constructor(init?: ProviderManagerInit | ProviderRuntimeContext) {
    const resolved = this.resolveInit(init);
    this.providers = new Map<string, IProvider>();
    this.serverToolsProvider = null;
    this.settingsService = resolved.settingsService;
    this.config = resolved.config ?? this.config;
    this.runtime = resolved.runtime;
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
      if (!fallback) {
        fallback = getActiveProviderRuntimeContext();
      }
      return fallback;
    };

    if (!init) {
      const resolved = ensureFallback();
      return {
        settingsService: resolved.settingsService,
        config: resolved.config,
        runtime: resolved,
      };
    }

    if (
      typeof init === 'object' &&
      init !== null &&
      'settingsService' in init &&
      ('runtimeId' in init || 'metadata' in init)
    ) {
      const context = init as ProviderRuntimeContext;
      return {
        settingsService: context.settingsService,
        config: context.config,
        runtime: context,
      };
    }

    const initObj = init as ProviderManagerInit;
    const runtime = initObj.runtime;
    let settingsService =
      initObj.settingsService ?? runtime?.settingsService ?? null;
    let config: Config | undefined =
      initObj.config ?? runtime?.config ?? undefined;

    if (!settingsService || !config) {
      const resolved = ensureFallback();
      settingsService = settingsService ?? resolved.settingsService;
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
        baseProvider.wrappedProvider
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

    const settingsService = baseRuntime.settingsService;
    if (!settingsService) {
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
   * This method enforces that all runtime context is provided per-call and that
   * providers cannot rely on stored state.
   */
  normalizeRuntimeInputs(
    rawOptions: GenerateChatOptions,
    providerName?: string,
  ): GenerateChatOptions {
    const runtimeId = rawOptions.runtime?.runtimeId || 'unknown';
    const targetProvider = providerName || this.getActiveProviderName();

    // REQ-SP4-002: Check for required settings service and config in runtime context
    const settingsService =
      rawOptions.settings ?? rawOptions.runtime?.settingsService;
    const config = rawOptions.config ?? rawOptions.runtime?.config;

    if (!settingsService) {
      throw new ProviderRuntimeNormalizationError({
        providerKey: 'ProviderManager',
        message:
          'ProviderManager requires call-scoped settings; legacy provider state is disabled.',
        requirement: 'REQ-SP4-002',
        runtimeId,
        stage: 'normalizeRuntimeInputs',
        metadata: {
          hint: 'SettingsService must be provided in options.settings or runtime.settingsService',
        },
      });
    }

    if (!config) {
      throw new ProviderRuntimeNormalizationError({
        providerKey: 'ProviderManager',
        message:
          'ProviderManager requires call-scoped config; legacy provider state is disabled.',
        requirement: 'REQ-SP4-002',
        runtimeId,
        stage: 'normalizeRuntimeInputs',
        metadata: {
          hint: 'Config must be provided in options.config or runtime.config',
        },
      });
    }

    // REQ-SP4-003: Compose normalized.resolved with runtime helpers
    const providerSettings =
      settingsService.getProviderSettings(targetProvider);
    const providerInstance = this.providers.get(targetProvider);
    const configSettingsService =
      typeof (config as unknown as { getSettingsService?: () => unknown })
        .getSettingsService === 'function'
        ? (
            config as unknown as { getSettingsService: () => unknown }
          ).getSettingsService()
        : undefined;
    const configMatchesSettingsService =
      !configSettingsService || configSettingsService === settingsService;
    const activeProviderRaw = settingsService.get('activeProvider');
    const activeProviderName =
      typeof activeProviderRaw === 'string' ? activeProviderRaw.trim() : '';
    const shouldApplyGlobalEphemerals =
      configMatchesSettingsService &&
      (!activeProviderName || activeProviderName === targetProvider);
    // Debug: Log incoming authToken before normalization
    logger.debug(() => {
      const token = rawOptions.resolved?.authToken;
      const tokenStr = typeof token === 'string' ? token : '';
      return `[normalizeRuntimeInputs] provider=${targetProvider}, incoming authToken present=${Boolean(tokenStr.trim())} length=${tokenStr.length}`;
    });

    const resolved = {
      model:
        rawOptions.resolved?.model ??
        (providerSettings.model as string | undefined) ??
        (shouldApplyGlobalEphemerals ? config.getModel?.() : undefined) ??
        providerInstance?.getDefaultModel?.() ??
        undefined,
      baseURL:
        rawOptions.resolved?.baseURL ??
        (providerSettings.baseURL as string | undefined) ??
        (providerSettings.baseUrl as string | undefined),
      authToken:
        rawOptions.resolved?.authToken ??
        (providerSettings.apiKey as string | undefined),
      telemetry: {
        ...rawOptions.resolved?.telemetry,
        runtimeId,
        normalizedAt: new Date().toISOString(),
        provider: targetProvider,
      },
    };

    const effectiveConfig = rawOptions.config ?? config ?? null;
    // Debug: Log resolved authToken before global auth-key check
    logger.debug(() => {
      const token = resolved.authToken;
      const tokenStr = typeof token === 'string' ? token : '';
      return `[normalizeRuntimeInputs] provider=${targetProvider}, resolved authToken present=${Boolean(tokenStr.trim())} length=${tokenStr.length}`;
    });

    if (
      shouldApplyGlobalEphemerals &&
      effectiveConfig &&
      typeof (
        effectiveConfig as Config & {
          getEphemeralSetting?: (key: string) => unknown;
        }
      ).getEphemeralSetting === 'function' &&
      (typeof resolved.authToken !== 'string' ||
        resolved.authToken.trim() === '')
    ) {
      const globalAuthKey = (
        effectiveConfig as Config & {
          getEphemeralSetting?: (key: string) => unknown;
        }
      ).getEphemeralSetting?.('auth-key') as string | undefined;

      // Debug: Log global auth-key check
      logger.debug(() => {
        const tokenStr = typeof globalAuthKey === 'string' ? globalAuthKey : '';
        return `[normalizeRuntimeInputs] provider=${targetProvider}, global auth-key present=${Boolean(tokenStr.trim())} length=${tokenStr.length}, will use: ${globalAuthKey ? 'YES' : 'NO'}`;
      });

      if (globalAuthKey && globalAuthKey.trim() !== '') {
        resolved.authToken = globalAuthKey.trim();
      } else if (process.env.DEBUG) {
        logger.debug(
          () =>
            `[ProviderManager] Missing auth token for provider '${targetProvider}' even after checking global auth-key.`,
        );
      }
    }

    if (!resolved.baseURL && shouldApplyGlobalEphemerals) {
      const configBaseUrl =
        typeof config.getEphemeralSetting === 'function'
          ? (config.getEphemeralSetting('base-url') as string | undefined)
          : undefined;
      if (configBaseUrl && typeof configBaseUrl === 'string') {
        const trimmed = configBaseUrl.trim();
        if (trimmed) {
          resolved.baseURL = trimmed;
        }
      }
    }

    if (!resolved.baseURL) {
      const providerBaseUrl = this.getBaseUrlFromProvider(providerInstance);
      if (providerBaseUrl) {
        resolved.baseURL = providerBaseUrl;
      }
    }

    // REQ-SP4-003: Validate required fields in resolved options
    const missingFields: string[] = [];
    if (!resolved.model) missingFields.push('model');
    // Note: Gemini and some providers don't require baseURL/authToken in all configurations
    const baseUrlOptionalProviders = new Set([
      'gemini',
      'openai',
      'openai-responses',
      'anthropic',
      'openaivercel',
      'load-balancer', // Resolves baseURL at request time via sub-profile selection
    ]);
    if (!resolved.baseURL && !baseUrlOptionalProviders.has(targetProvider)) {
      missingFields.push('baseURL');
    }
    if (!resolved.authToken && targetProvider !== 'gemini') {
      // Check if provider can resolve auth lazily (e.g., via OAuth)
      // If the provider has getAuthToken(), it can handle its own auth precedence
      const providerInstance = this.providers.get(targetProvider);

      // Check for getAuthToken on the actual provider
      // (might be wrapped in multiple layers: LoggingProviderWrapper → RetryOrchestrator → BaseProvider)
      interface ProviderWithWrapper {
        wrappedProvider?: IProvider;
      }
      interface ProviderWithAuth {
        getAuthToken?: () => Promise<string>;
      }

      // Traverse the full wrapper chain to find the actual provider
      let actualProvider: IProvider | undefined = providerInstance;
      while (actualProvider && 'wrappedProvider' in actualProvider) {
        actualProvider = (actualProvider as ProviderWithWrapper)
          .wrappedProvider;
      }

      const canResolveAuth =
        actualProvider &&
        'getAuthToken' in actualProvider &&
        typeof (actualProvider as ProviderWithAuth).getAuthToken === 'function';

      if (!canResolveAuth) {
        // Only fail for providers without lazy auth resolution capability
        missingFields.push('authToken');
      }
      // Otherwise let the provider run its multi-modal precedence chain:
      // 1. Manual key (from /key)
      // 2. Keyfile (from /keyfile)
      // 3. Environment variables
      // 4. OAuth token (if enabled)
    }

    if (missingFields.length > 0) {
      throw new ProviderRuntimeNormalizationError({
        providerKey: 'ProviderManager',
        message: `Incomplete runtime resolution (${missingFields.join(', ')}) for runtimeId=${runtimeId}`,
        requirement: 'REQ-SP4-003',
        runtimeId,
        stage: 'normalizeRuntimeInputs',
        metadata: { missingFields, provider: targetProvider },
      });
    }

    // REQ-SP4-005: Ensure normalized.userMemory and metadata derive from runtime context
    const userMemory = rawOptions.userMemory ?? config.getUserMemory?.();
    const metadata = {
      ...rawOptions.metadata,
      ...rawOptions.runtime?.metadata,
      _normalized: true,
      _normalizationTime: new Date().toISOString(),
      _runtimeId: runtimeId,
      _provider: targetProvider,
    };

    const normalizedRuntime: ProviderRuntimeContext = {
      ...(rawOptions.runtime ?? {}),
      settingsService,
      config,
      runtimeId,
      metadata,
    };

    const userMemorySnapshot =
      typeof userMemory === 'string' ? userMemory : config.getUserMemory?.();

    const invocation =
      rawOptions.invocation ??
      createRuntimeInvocationContext({
        runtime: normalizedRuntime,
        settings: settingsService,
        providerName: targetProvider,
        ephemeralsSnapshot: this.buildEphemeralsSnapshot(
          settingsService,
          targetProvider,
        ),
        telemetry: resolved.telemetry,
        metadata,
        userMemory: userMemorySnapshot ?? undefined,
        fallbackRuntimeId: runtimeId,
      });

    return {
      ...rawOptions,
      settings: settingsService,
      config,
      runtime: normalizedRuntime,
      resolved,
      userMemory,
      metadata,
      invocation,
    };
  }

  private buildEphemeralsSnapshot(
    settingsService: SettingsService,
    providerName: string,
  ): Record<string, unknown> {
    const globalEphemerals = settingsService.getAllGlobalSettings();
    const providerEphemerals =
      settingsService.getProviderSettings(providerName);

    // @plan PLAN-20260126-SETTINGS-SEPARATION.P09
    // Filter out provider-config settings from global level
    // These should only appear in provider-scoped sections
    const snapshot: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(globalEphemerals)) {
      if (!PROVIDER_CONFIG_KEYS.has(key)) {
        snapshot[key] = value;
      }
    }
    snapshot[providerName] = { ...providerEphemerals };
    return snapshot;
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
    const capabilities = this.captureProviderCapabilities(provider);
    this.providerCapabilities.set(provider.name, capabilities);

    // Log provider capability information if logging enabled
    if (this.config?.getConversationLoggingEnabled()) {
      const context = this.createProviderContext(provider, capabilities);
      logProviderCapability(
        this.config,
        new ProviderCapabilityEvent(provider.name, capabilities, context),
      );
    }

    // If this is the default provider and no provider is active, set it as active
    const currentActiveProvider = this.settingsService.get(
      'activeProvider',
    ) as string;
    if (provider.isDefault && !currentActiveProvider) {
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
      this.config?.getConversationLoggingEnabled() &&
      previousProviderName &&
      previousProviderName !== name
    ) {
      logProviderSwitch(
        this.config,
        new ProviderSwitchEvent(
          previousProviderName,
          name,
          this.generateConversationId(),
          this.isContextPreserved(previousProviderName, name),
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
        this.serverToolsProvider = this.providers.get(name) || null;
      }
    }
    // If switching away from Gemini but serverToolsProvider is not set,
    // configure a Gemini provider for serverTools if available
    else if (!this.serverToolsProvider && this.providers.has('gemini')) {
      this.serverToolsProvider = this.providers.get('gemini') || null;
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
      const preferredFromConfig = this.config?.getProvider?.();
      if (preferredFromConfig && this.providers.has(preferredFromConfig)) {
        resolvedName = preferredFromConfig;
      } else if (this.providers.has('openai')) {
        resolvedName = 'openai';
      } else {
        const firstProvider = this.providers.keys().next();
        resolvedName = firstProvider.done ? '' : firstProvider.value;
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

    // Step 1: Get models from provider (live API or fallback)
    const baseModels = await provider.getModels();

    // Step 2: Initialize registry if needed (non-blocking failure)
    try {
      await initializeModelRegistry();
    } catch {
      // Registry init failed - return unhydrated
      logger.debug(
        () =>
          `[getAvailableModels] Registry init failed for provider: ${provider!.name}`,
      );
      return baseModels.map((m) => ({ ...m, hydrated: false }));
    }

    // Step 3: Get modelsDevProviderIds for hydration lookup
    const modelsDevProviderIds = getModelsDevProviderIds(provider.name);

    // Step 4: If provider returned no models, fall back to registry-only models
    if (baseModels.length === 0 && modelsDevProviderIds.length > 0) {
      logger.debug(
        () =>
          `[getAvailableModels] Provider ${provider!.name} returned 0 models, falling back to registry`,
      );
      const registry = getModelRegistry();
      if (registry.isInitialized()) {
        // Get models from registry for this provider (only those with tool support)
        const registryModels: HydratedModel[] = [];
        for (const providerId of modelsDevProviderIds) {
          const providerModels = registry.getByProvider(providerId);
          for (const rm of providerModels) {
            // Only exclude models that explicitly disable tool support
            if (rm.capabilities?.toolCalling === false) continue;

            registryModels.push({
              id: rm.modelId,
              name: rm.name,
              provider: provider!.name,
              supportedToolFormats: [],
              contextWindow: rm.contextWindow,
              maxOutputTokens: rm.maxOutputTokens,
              capabilities: rm.capabilities,
              pricing: rm.pricing,
              limits: rm.limits,
              metadata: rm.metadata,
              providerId: rm.providerId,
              modelId: rm.modelId,
              family: rm.family,
              hydrated: true,
            });
          }
        }
        if (registryModels.length > 0) {
          return registryModels;
        }
      }
    }

    logger.debug(
      () =>
        `[getAvailableModels] Hydrating ${baseModels.length} models for provider: ${provider!.name} with modelsDevIds: ${JSON.stringify(modelsDevProviderIds)}`,
    );

    // Step 5: Hydrate with models.dev data
    const hydratedModels = await hydrateModelsWithRegistry(
      baseModels,
      modelsDevProviderIds,
    );

    // Step 6: Filter to only models with tool support (required for CLI)
    return hydratedModels.filter((m) => m.capabilities?.toolCalling !== false);
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
    // Generate unique conversation ID for session
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private isContextPreserved(
    fromProvider: string,
    toProvider: string,
  ): boolean {
    // Analyze whether context can be preserved between providers
    const fromCapabilities = this.providerCapabilities.get(fromProvider);
    const toCapabilities = this.providerCapabilities.get(toProvider);

    if (!fromCapabilities || !toCapabilities) {
      return false; // Can't analyze without capabilities
    }

    // Context is better preserved between providers with similar capabilities
    const capabilityScore = this.calculateCapabilityCompatibility(
      fromCapabilities,
      toCapabilities,
    );

    // Context is considered preserved if compatibility is high
    return capabilityScore > 0.7;
  }

  private getStoredModelName(provider: IProvider): string {
    const providerSettings = this.settingsService.getProviderSettings(
      provider.name,
    );
    const storedModel = providerSettings.model as string | undefined;
    if (storedModel && typeof storedModel === 'string' && storedModel.trim()) {
      return storedModel;
    }

    if (
      this.config &&
      typeof this.config.getProvider === 'function' &&
      this.config.getProvider() === provider.name
    ) {
      const configModel = this.config.getModel();
      if (configModel) {
        return configModel;
      }
    }

    return provider.getDefaultModel?.() ?? '';
  }

  private captureProviderCapabilities(
    provider: IProvider,
  ): ProviderCapabilities {
    const hints = PROVIDER_CAPABILITY_HINTS[provider.name] ?? {};

    return {
      supportsStreaming: true, // All current providers support streaming
      supportsTools: provider.getServerTools().length > 0,
      supportsVision: this.detectVisionSupport(provider),
      maxTokens: this.getProviderMaxTokens(provider),
      supportedFormats: this.getSupportedToolFormats(provider),
      hasModelSelection: hints.hasModelSelection ?? true,
      hasApiKeyConfig: hints.hasApiKeyConfig ?? true,
      hasBaseUrlConfig: hints.hasBaseUrlConfig ?? true,
      supportsPaidMode: typeof provider.isPaidMode === 'function',
    };
  }

  private detectVisionSupport(provider: IProvider): boolean {
    // Provider-specific vision detection logic
    const model = this.getStoredModelName(provider).toLowerCase();
    switch (provider.name) {
      case 'gemini': {
        return true;
      }
      case 'openai': {
        return model.includes('vision') || model.includes('gpt-4');
      }
      case 'anthropic': {
        return model.includes('claude-3');
      }
      default:
        return false;
    }
  }

  private getProviderMaxTokens(provider: IProvider): number {
    const model = this.getStoredModelName(provider).toLowerCase();

    switch (provider.name) {
      case 'gemini':
        if (model.includes('pro')) return 32768;
        if (model.includes('flash')) return 8192;
        return 8192;
      case 'openai':
        if (model.includes('gpt-4')) return 8192;
        if (model.includes('gpt-3.5')) return 4096;
        return 4096;
      case 'anthropic':
        if (model.includes('claude-3')) return 200000;
        return 100000;
      default:
        return 4096;
    }
  }

  private getSupportedToolFormats(provider: IProvider): string[] {
    switch (provider.name) {
      case 'gemini':
        return ['function_calling', 'gemini_tools'];
      case 'openai':
        return ['function_calling', 'json_schema', 'hermes'];
      case 'anthropic':
        return ['xml_tools', 'anthropic_tools'];
      default:
        return [];
    }
  }

  private createProviderContext(
    provider: IProvider,
    capabilities: ProviderCapabilities,
  ): ProviderContext {
    const providerSettings = this.settingsService.getProviderSettings(
      provider.name,
    );
    const toolFormatSetting =
      (providerSettings.toolFormat as string | undefined) ?? 'auto';
    return {
      providerName: provider.name,
      currentModel: this.getStoredModelName(provider) || 'unknown',
      toolFormat: toolFormatSetting,
      isPaidMode: provider.isPaidMode?.() || false,
      capabilities,
      sessionStartTime: Date.now(),
    };
  }

  private calculateCapabilityCompatibility(
    from: ProviderCapabilities,
    to: ProviderCapabilities,
  ): number {
    let score = 0;
    let totalChecks = 0;

    // Check tool support compatibility
    totalChecks++;
    if (from.supportsTools === to.supportsTools) score++;

    // Check vision support compatibility
    totalChecks++;
    if (from.supportsVision === to.supportsVision) score++;

    // Check streaming compatibility (all providers support streaming currently)
    totalChecks++;
    if (from.supportsStreaming === to.supportsStreaming) score++;

    // Check tool format compatibility
    totalChecks++;
    const hasCommonFormats = from.supportedFormats.some((format) =>
      to.supportedFormats.includes(format),
    );
    if (hasCommonFormats) score++;

    return score / totalChecks;
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
    logger.debug(
      () =>
        `[ProviderManager.accumulateSessionTokens] Called with: cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}, cacheReads===undefined: ${usage.cacheReads === undefined}, cacheWrites===undefined: ${usage.cacheWrites === undefined}`,
    );

    // Only accumulate non-negative values
    this.sessionTokenUsage.input += Math.max(0, usage.input || 0);
    this.sessionTokenUsage.output += Math.max(0, usage.output || 0);

    // For cache field: use the explicit cache value OR cacheReads if cache is 0
    // This handles both Gemini (which uses cached_content_token_count) and
    // Anthropic (which uses cache_read_input_tokens)
    const cacheTokens =
      Math.max(0, usage.cache || 0) || Math.max(0, usage.cacheReads || 0);
    this.sessionTokenUsage.cache += cacheTokens;

    this.sessionTokenUsage.tool += Math.max(0, usage.tool || 0);
    this.sessionTokenUsage.thought += Math.max(0, usage.thought || 0);
    this.sessionTokenUsage.total +=
      Math.max(0, usage.input || 0) +
      Math.max(0, usage.output || 0) +
      cacheTokens +
      Math.max(0, usage.tool || 0) +
      Math.max(0, usage.thought || 0);

    // Track cache reads/writes if provided
    // Note: cacheWrites can be null (provider doesn't report) vs undefined (not in usage object)
    if (usage.cacheReads !== undefined || usage.cacheWrites !== undefined) {
      logger.debug(
        () =>
          `[ProviderManager.accumulateSessionTokens] Received cache usage: cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}`,
      );
      this.trackCacheUsage(
        Math.max(0, usage.cacheReads || 0),
        usage.cacheWrites === null || usage.cacheWrites === undefined
          ? null
          : Math.max(0, usage.cacheWrites),
      );
    } else {
      logger.debug(
        () =>
          `[ProviderManager.accumulateSessionTokens] No cache usage in this request`,
      );
    }
  }

  /**
   * Reset session token usage counters
   */
  resetSessionTokenUsage(): void {
    this.sessionTokenUsage = {
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    };
  }

  /**
   * Get current session token usage
   */
  getSessionTokenUsage(): {
    input: number;
    output: number;
    cache: number;
    tool: number;
    thought: number;
    total: number;
  } {
    // Validate and replace any NaN or undefined values with 0
    return {
      input: this.sessionTokenUsage.input || 0,
      output: this.sessionTokenUsage.output || 0,
      cache: this.sessionTokenUsage.cache || 0,
      tool: this.sessionTokenUsage.tool || 0,
      thought: this.sessionTokenUsage.thought || 0,
      total: this.sessionTokenUsage.total || 0,
    };
  }

  /**
   * Track cache read/write statistics from a request
   * @param cacheReads - Number of tokens read from cache
   * @param cacheWrites - Number of tokens written to cache, or null if provider doesn't report this
   */
  trackCacheUsage(cacheReads: number, cacheWrites: number | null): void {
    logger.debug(
      () =>
        `[ProviderManager.trackCacheUsage] Called with cacheReads=${cacheReads}, cacheWrites=${cacheWrites}`,
    );
    if (cacheReads > 0) {
      this.cacheStats.totalCacheReads += cacheReads;
      this.cacheStats.requestsWithCacheHits++;
      logger.debug(
        () =>
          `[ProviderManager.trackCacheUsage] Updated totalCacheReads to ${this.cacheStats.totalCacheReads}`,
      );
    }
    // Only track cache writes if the provider reports them (not null)
    if (cacheWrites !== null) {
      // Initialize from null to 0 on first reported value
      if (this.cacheStats.totalCacheWrites === null) {
        this.cacheStats.totalCacheWrites = 0;
      }
      this.cacheStats.totalCacheWrites += cacheWrites;
      if (cacheWrites > 0) {
        this.cacheStats.requestsWithCacheWrites++;
      }
      logger.debug(
        () =>
          `[ProviderManager.trackCacheUsage] Updated totalCacheWrites to ${this.cacheStats.totalCacheWrites}`,
      );
    }

    // Recalculate hit rate
    // Hit rate = cache reads / (cache reads + uncached input) * 100
    const totalPromptTokens = this.sessionTokenUsage.input;
    const totalInputTokens =
      this.cacheStats.totalCacheReads + totalPromptTokens;
    if (totalInputTokens > 0) {
      this.cacheStats.hitRate =
        (this.cacheStats.totalCacheReads / totalInputTokens) * 100;
      logger.debug(
        () =>
          `[ProviderManager.trackCacheUsage] Updated hitRate to ${this.cacheStats.hitRate}% (cacheReads=${this.cacheStats.totalCacheReads}, uncachedInput=${totalPromptTokens}, total=${totalInputTokens})`,
      );
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics(): CacheStatistics {
    return { ...this.cacheStats };
  }

  /**
   * Get performance metrics for the active provider
   * @plan PLAN-20250909-TOKTRACK
   */
  getProviderMetrics(providerName?: string) {
    const name = providerName || this.getActiveProvider()?.name;
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
      providerName ||
      (this.settingsService.get('activeProvider') as string) ||
      '';
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

    if (!runtimeContext.settingsService) {
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
      settingsService: runtimeContext.settingsService,
      config: resolvedConfig,
      metadata: statelessMetadata,
    };
    this.settingsService = runtimeContext.settingsService;
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
        statelessAware.wrappedProvider as IProvider,
        metadata,
      );
    }
  }

  compareProviders(provider1: string, provider2: string): ProviderComparison {
    const cap1 = this.providerCapabilities.get(provider1);
    const cap2 = this.providerCapabilities.get(provider2);

    if (!cap1 || !cap2) {
      throw new Error('Cannot compare providers: capabilities not available');
    }

    return {
      provider1,
      provider2,
      capabilities: {
        [provider1]: cap1,
        [provider2]: cap2,
      },
      compatibility: this.calculateCapabilityCompatibility(cap1, cap2),
      recommendation: this.generateProviderRecommendation(
        provider1,
        provider2,
        cap1,
        cap2,
      ),
    };
  }

  private generateProviderRecommendation(
    provider1: string,
    provider2: string,
    cap1: ProviderCapabilities,
    cap2: ProviderCapabilities,
  ): string {
    if (cap1.maxTokens > cap2.maxTokens) {
      return `${provider1} supports longer contexts (${cap1.maxTokens} vs ${cap2.maxTokens} tokens)`;
    }

    if (cap1.supportsVision && !cap2.supportsVision) {
      return `${provider1} supports vision capabilities`;
    }

    if (cap1.supportedFormats.length > cap2.supportedFormats.length) {
      return `${provider1} supports more tool formats`;
    }

    return 'Providers have similar capabilities';
  }

  private getBaseUrlFromProvider(
    provider: IProvider | undefined,
  ): string | undefined {
    if (!provider) {
      return undefined;
    }

    const visited = new Set<IProvider>();
    let current: IProvider | undefined = provider;

    while (current) {
      if (visited.has(current)) {
        break;
      }
      visited.add(current);

      const baseConfig = (
        current as {
          baseProviderConfig?: { baseURL?: string; baseUrl?: string };
        }
      ).baseProviderConfig;
      if (baseConfig) {
        const candidate =
          typeof baseConfig.baseURL === 'string' &&
          baseConfig.baseURL.trim() !== ''
            ? baseConfig.baseURL.trim()
            : typeof baseConfig.baseUrl === 'string' &&
                baseConfig.baseUrl.trim() !== ''
              ? baseConfig.baseUrl.trim()
              : undefined;
        if (candidate) {
          return candidate;
        }
      }

      const providerConfig = (
        current as {
          providerConfig?: { baseURL?: string; baseUrl?: string };
        }
      ).providerConfig;
      if (providerConfig) {
        const candidate =
          typeof providerConfig.baseURL === 'string' &&
          providerConfig.baseURL.trim() !== ''
            ? providerConfig.baseURL.trim()
            : typeof providerConfig.baseUrl === 'string' &&
                providerConfig.baseUrl.trim() !== ''
              ? providerConfig.baseUrl.trim()
              : undefined;
        if (candidate) {
          return candidate;
        }
      }

      const maybeHasBaseUrl = current as unknown as {
        getBaseURL?: () => string | undefined;
      };
      if (typeof maybeHasBaseUrl.getBaseURL === 'function') {
        try {
          const reported = maybeHasBaseUrl.getBaseURL();
          if (reported && reported.trim() !== '') {
            return reported.trim();
          }
        } catch {
          // ignore provider errors
        }
      }

      const maybeWrapped = current as unknown as {
        wrappedProvider?: IProvider;
      };
      if (maybeWrapped.wrappedProvider) {
        current = maybeWrapped.wrappedProvider;
        continue;
      }

      break;
    }

    return undefined;
  }
}
