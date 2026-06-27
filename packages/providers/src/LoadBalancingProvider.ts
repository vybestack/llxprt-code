/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IProvider,
  GenerateChatOptions,
  ProviderToolset,
} from './IProvider.js';
import type { IModel } from './IModel.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderManager } from './ProviderManager.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { getErrorStatus } from '@vybestack/llxprt-code-core/utils/retry.js';
import { LoadBalancerFailoverError } from './errors.js';
import { CircuitBreakerManager } from './loadBalancing/circuitBreakerManager.js';
import { TPMTracker } from './loadBalancing/tpmTracker.js';
import { BackendMetricsCollector } from './loadBalancing/backendMetrics.js';
import {
  extractFailoverSettings as extractFailoverSettingsFromEphemeral,
  shouldFailover as shouldFailoverOnError,
  isImmediateFailoverError as isImmediateFailover,
} from './loadBalancing/failoverSettings.js';
import {
  wrapWithTimeout as wrapWithFirstChunkTimeout,
  isTimeoutError,
} from './loadBalancing/streamTimeout.js';
import { buildExtendedStats } from './loadBalancing/statsBuilder.js';
import { buildRoundRobinResolvedOptions as buildRoundRobinResolvedOptionsExternal } from './loadBalancing/resolvedOptionsBuilder.js';
import { cloneContentsForCompression } from './loadBalancing/contentClone.js';
import {
  LoadBalancerAllContextLimitsExceededError,
  LoadBalancerCompressionCallbackError,
  LoadBalancerContextLimitError,
} from './loadBalancing/contextLimitError.js';
import {
  estimateRequestTokens,
  type EstimationResult,
} from './loadBalancing/loadBalancerTokenEstimator.js';
import { getTargetContextLimit } from './loadBalancing/targetContextLimit.js';
import {
  getMinMemberContextWindow,
  resolveSubProfileModel,
} from './loadBalancing/subProfileHelpers.js';
import type { TokenAccountingDiagnostics } from './loadBalancing/tokenAccountingDiagnostics.js';
import {
  isResolvedSubProfile,
  validateLoadBalancingStrategy,
  type BackendMetrics,
  type CompressionCallback,
  type CircuitBreakerState,
  type ExtendedLoadBalancerStats,
  type FailoverSettings,
  type LoadBalancerSubProfile,
  type LoadBalancingProviderConfig,
  type ResolvedSubProfile,
} from './loadBalancing/loadBalancerTypes.js';
export type {
  BackendMetrics,
  CircuitBreakerState,
  CompressionCallback,
  ExtendedLoadBalancerStats,
  FailoverSettings,
  LoadBalancerStats,
  LoadBalancerSubProfile,
  LoadBalancingProviderConfig,
  ResolvedSubProfile,
} from './loadBalancing/loadBalancerTypes.js';
export { isResolvedSubProfile } from './loadBalancing/loadBalancerTypes.js';
export type { TokenAccountingDiagnostics } from './loadBalancing/tokenAccountingDiagnostics.js';

export { isLoadBalancerProfileFormat } from './loadBalancing/loadBalancerProfileFormat.js';

/**
 * Load balancing provider that distributes requests across multiple sub-profiles
 */
export class LoadBalancingProvider implements IProvider {
  readonly name = 'load-balancer';
  private roundRobinIndex = 0;
  private readonly logger = new DebugLogger('llxprt:providers:load-balancer');
  private stats: Map<string, number> = new Map();
  private lastSelected: string | null = null;
  private totalRequests = 0;
  private circuitBreakerStates: Map<string, CircuitBreakerState> = new Map();
  private tpmBuckets: Map<number, Map<string, number>> = new Map();
  private backendMetrics: Map<string, BackendMetrics> = new Map();
  private currentFailoverIndex = 0;
  private compressionCallback: CompressionCallback | null = null;
  private accountingSource: string | null = null;
  private lastEstimatedTokens: number | null = null;
  private diagnosticsSelectedSubProfile: string | null = null;
  private diagnosticsActiveProvider: string | null = null;
  private diagnosticsActiveModel: string | null = null;

  constructor(
    private readonly config: LoadBalancingProviderConfig,
    private readonly providerManager: ProviderManager,
  ) {
    // Validate required dependencies
    // Widen to unknown for defensive runtime check (DI frameworks may pass null/undefined)
    const providerManagerRuntime: unknown = providerManager;
    if (
      providerManagerRuntime === undefined ||
      providerManagerRuntime === null
    ) {
      throw new Error(
        'LoadBalancingProvider requires a ProviderManager dependency',
      );
    }

    // Validate configuration
    this.validateConfig(config);

    this.circuitBreaker = new CircuitBreakerManager(
      this.circuitBreakerStates,
      this.logger,
      () => this.extractFailoverSettings(),
    );
    this.tpmTracker = new TPMTracker(this.tpmBuckets, this.logger);
    this.metricsCollector = new BackendMetricsCollector(this.backendMetrics);
  }

  /**
   * Validate the load balancing configuration
   * @plan PLAN-20251211issue486c - Updated to handle ResolvedSubProfile
   */
  private validateConfig(config: LoadBalancingProviderConfig): void {
    // Check for empty subProfiles array
    if (config.subProfiles.length === 0) {
      throw new Error(
        'LoadBalancingProvider requires at least one sub-profile in configuration',
      );
    }

    validateLoadBalancingStrategy((config as { strategy: unknown }).strategy);

    // Failover strategy requires at least 2 sub-profiles
    if (config.strategy === 'failover' && config.subProfiles.length < 2) {
      throw new Error(
        'Failover strategy requires at least 2 sub-profiles (minimum 2 backends for failover)',
      );
    }

    // Validate each sub-profile
    for (const subProfile of config.subProfiles) {
      if (!subProfile.name || typeof subProfile.name !== 'string') {
        throw new Error(
          'Each sub-profile must have a valid "name" field (non-empty string)',
        );
      }

      if (
        !subProfile.providerName ||
        typeof subProfile.providerName !== 'string'
      ) {
        throw new Error(
          `Sub-profile "${subProfile.name}" must have a valid "providerName" field (non-empty string)`,
        );
      }

      // Additional validation for ResolvedSubProfile
      if (isResolvedSubProfile(subProfile)) {
        if (!subProfile.model || typeof subProfile.model !== 'string') {
          throw new Error(
            `ResolvedSubProfile "${subProfile.name}" must have a valid "model" field (non-empty string)`,
          );
        }

        // Use runtime-widened local to reject null explicitly (typeof null === 'object')
        const ephemeralSettingsRuntime: unknown = subProfile.ephemeralSettings;
        if (
          typeof ephemeralSettingsRuntime !== 'object' ||
          ephemeralSettingsRuntime === null
        ) {
          throw new Error(
            `ResolvedSubProfile "${subProfile.name}" must have a valid "ephemeralSettings" field (object)`,
          );
        }

        // Use runtime-widened local to reject null explicitly (typeof null === 'object')
        const modelParamsRuntime: unknown = subProfile.modelParams;
        if (
          typeof modelParamsRuntime !== 'object' ||
          modelParamsRuntime === null
        ) {
          throw new Error(
            `ResolvedSubProfile "${subProfile.name}" must have a valid "modelParams" field (object)`,
          );
        }
      }
    }
  }
  selectNextSubProfile(): ResolvedSubProfile | LoadBalancerSubProfile {
    const subProfile = this.config.subProfiles[this.roundRobinIndex];
    this.roundRobinIndex =
      (this.roundRobinIndex + 1) % this.config.subProfiles.length;
    return subProfile;
  }

  async getModels(): Promise<IModel[]> {
    const contextWindow = this.getEffectiveContextLimit();
    return [
      {
        id: this.config.profileName,
        name: this.config.profileName,
        provider: this.name,
        supportedToolFormats: [],
        ...(contextWindow !== undefined && { contextWindow }),
      },
    ];
  }

  private getEffectiveContextLimit(): number | undefined {
    if (
      this.config.contextLimit !== undefined &&
      this.config.contextLimit > 0
    ) {
      return this.config.contextLimit;
    }
    return getMinMemberContextWindow(this.config.subProfiles);
  }

  /**
   * Estimate request tokens for a given sub-profile using its provider/model
   * tokenizer via the injected RuntimeTokenizerFactory, falling back to a
   * generic estimate. Updates token-accounting diagnostics.
   * @plan PLAN-2207-LB-TOKEN-ACCOUNTING
   */
  private async estimateForSubProfile(
    contents: IContent[],
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  ): Promise<EstimationResult> {
    const model = resolveSubProfileModel(subProfile);
    const factory = this.providerManager.getTokenizerFactory();
    const result = await estimateRequestTokens(
      contents,
      subProfile.providerName,
      model,
      { tokenizerFactory: factory },
    );
    this.accountingSource = result.source;
    this.lastEstimatedTokens = result.tokens;
    this.diagnosticsSelectedSubProfile = subProfile.name;
    this.diagnosticsActiveProvider = subProfile.providerName;
    this.diagnosticsActiveModel = model || null;
    return result;
  }

  /**
   * Enforce the target context limit for a sub-profile, attempting compression
   * before throwing when the estimate exceeds the limit.
   * @plan PLAN-2207-LB-TOKEN-ACCOUNTING
   */
  private async enforceTokenLimitForTarget(
    options: GenerateChatOptions,
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  ): Promise<GenerateChatOptions> {
    const sharedLimit = this.getEffectiveContextLimit();
    const contextLimit = getTargetContextLimit(subProfile, sharedLimit);
    if (contextLimit === undefined) {
      return options;
    }

    let result = await this.estimateForSubProfile(options.contents, subProfile);
    if (result.tokens <= contextLimit) {
      return options;
    }

    if (this.compressionCallback) {
      this.logger.debug(
        () =>
          `[LB:token-guard] Estimate ${result.tokens} exceeds limit ${contextLimit} for ${subProfile.name}, attempting compression`,
      );
      let clonedContents: IContent[];
      try {
        clonedContents = cloneContentsForCompression(options.contents);
      } catch (cloneError) {
        this.logger.debug(
          () =>
            `[LB:token-guard] Content clone failed for ${subProfile.name}: ${String(cloneError)}`,
        );
        throw new LoadBalancerContextLimitError({
          profileName: this.config.profileName,
          subProfileName: subProfile.name,
          tokens: result.tokens,
          contextLimit,
          cause:
            cloneError instanceof Error
              ? cloneError
              : new Error(String(cloneError)),
        });
      }
      let compressed: IContent[];
      try {
        compressed = await this.compressionCallback(clonedContents);
      } catch (error) {
        this.logger.debug(
          () =>
            `[LB:token-guard] Compression callback failed for ${subProfile.name}: ${String(error)}`,
        );
        throw new LoadBalancerCompressionCallbackError({
          profileName: this.config.profileName,
          subProfileName: subProfile.name,
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
      const compressedOptions = {
        ...options,
        contents: compressed,
      };
      result = await this.estimateForSubProfile(
        compressedOptions.contents,
        subProfile,
      );
      if (result.tokens <= contextLimit) {
        this.logger.debug(
          () =>
            `[LB:token-guard] Compression reduced estimate to ${result.tokens} for ${subProfile.name}`,
        );
        return compressedOptions;
      }
    }

    throw new LoadBalancerContextLimitError({
      profileName: this.config.profileName,
      subProfileName: subProfile.name,
      tokens: result.tokens,
      contextLimit,
    });
  }

  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    content: IContent[],
    tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent>;
  async *generateChatCompletion(
    optionsOrContent: GenerateChatOptions | IContent[],
    tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    // Normalize parameters to GenerateChatOptions format
    let options: GenerateChatOptions;
    if (Array.isArray(optionsOrContent)) {
      options = {
        contents: optionsOrContent,
        tools,
      };
    } else {
      options = optionsOrContent;
    }
    this.resetTokenAccountingDiagnostics();

    // Branch on strategy
    if (this.config.strategy === 'failover') {
      yield* this.executeWithFailover(options);
      return;
    }

    // Phase 3 Step 1: Select next sub-profile using round-robin
    const subProfile = this.selectNextSubProfile();
    this.logger.debug(
      () => `Selected sub-profile: ${subProfile.name} for request`,
    );

    const enforcedOptions = await this.enforceTokenLimitForTarget(
      options,
      subProfile,
    );

    this.incrementStats(subProfile.name);
    const startTime = this.recordRequestStart(subProfile.name);
    const delegateProvider = this.providerManager.getProviderByName(
      subProfile.providerName,
    );

    if (!delegateProvider) {
      const errorMsg = `Provider "${subProfile.providerName}" not found for sub-profile "${subProfile.name}"`;
      this.logger.error(() => errorMsg);
      throw new Error(errorMsg);
    }

    this.logger.debug(
      () =>
        `Delegating to provider: ${delegateProvider.name} (sub-profile: ${subProfile.name})`,
    );

    const resolvedOptions = this.buildRoundRobinResolvedOptions(
      subProfile,
      enforcedOptions,
    );

    yield* this.yieldWithMetrics(
      delegateProvider,
      resolvedOptions,
      subProfile,
      startTime,
    );
  }

  /**
   * Build resolved options for round-robin strategy (non-failover path).
   * Handles both ResolvedSubProfile and LoadBalancerSubProfile.
   * @plan PLAN-20251211issue486c
   */
  private buildRoundRobinResolvedOptions(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
  ): GenerateChatOptions {
    return buildRoundRobinResolvedOptionsExternal(subProfile, options, {
      lbProfileEphemeralSettings: this.config.lbProfileEphemeralSettings,
      lbProfileModelParams: this.config.lbProfileModelParams,
      logger: this.logger,
      providerName: this.name,
      getEffectiveContextLimit: () =>
        getTargetContextLimit(subProfile, this.getEffectiveContextLimit()),
    });
  }

  private buildDelegateResolvedOptions(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
  ): GenerateChatOptions {
    return this.buildRoundRobinResolvedOptions(subProfile, options);
  }

  /**
   * Delegate to provider and yield chunks while tracking backend metrics.
   */
  private async *yieldWithMetrics(
    delegateProvider: IProvider,
    resolvedOptions: GenerateChatOptions,
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    startTime: number,
  ): AsyncGenerator<IContent> {
    try {
      const chunks: IContent[] = [];
      for await (const chunk of delegateProvider.generateChatCompletion(
        resolvedOptions,
      )) {
        chunks.push(chunk);
        yield chunk;
      }
      const tokensUsed = this.extractTokenCount(chunks);
      if (tokensUsed > 0) {
        this.updateTPM(subProfile.name, tokensUsed);
      }
      this.recordRequestSuccess(subProfile.name, startTime, tokensUsed);
    } catch (error) {
      this.recordRequestFailure(
        subProfile.name,
        startTime,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Get the model that can satisfy provider-level runtime normalization before
   * the request is delegated to a concrete sub-profile.
   */
  getDefaultModel(): string {
    const firstSubProfile = this.config.subProfiles[0];

    if (isResolvedSubProfile(firstSubProfile)) {
      return firstSubProfile.model;
    }

    return firstSubProfile.modelId ?? '';
  }

  /**
   * Get server tools (stub for Phase 1)
   * Will be implemented in later phases to aggregate tools from delegate providers
   */
  getServerTools(): string[] {
    return [];
  }

  /**
   * Invoke server tool (stub for Phase 1)
   * Will be implemented in later phases to delegate to appropriate provider
   */
  async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    throw new Error(
      `Server tool '${toolName}' not supported by load-balancer provider (stub implementation)`,
    );
  }

  /**
   * Increment stats for a sub-profile
   * Phase 5: Stats Integration
   */
  private incrementStats(subProfileName: string): void {
    this.stats.set(subProfileName, (this.stats.get(subProfileName) ?? 0) + 1);
    this.lastSelected = subProfileName;
    this.totalRequests++;
  }

  /**
   * Get load balancer statistics
   * Phase 5: Stats Integration
   * @plan PLAN-20251212issue489 - Phase 2: Updated to return ExtendedLoadBalancerStats
   */
  getStats(): ExtendedLoadBalancerStats {
    return buildExtendedStats(
      this.config.profileName,
      this.totalRequests,
      this.lastSelected,
      this.stats,
      this.circuitBreakerStates,
      this.backendMetrics,
      this.config.subProfiles,
      (name) => this.calculateTPM(name),
    );
  }

  resetStats(): void {
    this.stats.clear();
    this.lastSelected = null;
    this.totalRequests = 0;
    this.resetTokenAccountingDiagnostics();
  }

  setCompressionCallback(callback: CompressionCallback | null): void {
    this.compressionCallback = callback;
  }

  private resetTokenAccountingDiagnostics(): void {
    this.accountingSource = null;
    this.lastEstimatedTokens = null;
    this.diagnosticsSelectedSubProfile = null;
    this.diagnosticsActiveProvider = null;
    this.diagnosticsActiveModel = null;
  }

  getTokenAccountingDiagnostics(): TokenAccountingDiagnostics {
    return {
      profileName: this.config.profileName,
      selectedSubProfile: this.diagnosticsSelectedSubProfile,
      activeProvider: this.diagnosticsActiveProvider,
      activeModel: this.diagnosticsActiveModel,
      accountingSource: this.accountingSource ?? 'unknown',
      sharedContextLimit: this.getEffectiveContextLimit() ?? null,
      lastEstimatedTokens: this.lastEstimatedTokens,
    };
  }

  /**
   * Get current failover index (for testing/debugging)
   * @plan PLAN-20251217issue902 - Sticky failover behavior
   */
  getCurrentFailoverIndex(): number {
    return this.currentFailoverIndex;
  }

  /**
   * Reset failover index to 0 (for testing)
   * @plan PLAN-20251217issue902 - Sticky failover behavior
   */
  resetFailoverIndex(): void {
    this.currentFailoverIndex = 0;
  }

  /**
   * Extract failover settings from ephemeral settings
   * @plan PLAN-20251212issue488
   * @plan PLAN-20251212issue489 - Phase 1: Extended with advanced settings
   */
  private extractFailoverSettings(): FailoverSettings {
    return extractFailoverSettingsFromEphemeral(
      this.config.lbProfileEphemeralSettings,
    );
  }

  private shouldFailover(error: unknown, settings: FailoverSettings): boolean {
    return shouldFailoverOnError(error, settings);
  }

  private isImmediateFailoverError(error: unknown): boolean {
    return isImmediateFailover(error);
  }

  /**
   * Build resolved options for a sub-profile
   * @plan PLAN-20251212issue488
   */
  private buildResolvedOptions(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
  ): GenerateChatOptions {
    return this.buildDelegateResolvedOptions(subProfile, options);
  }

  /**
   * Initialize circuit breaker state for a backend
   * @plan PLAN-20251212issue489 - Phase 2
   */

  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly tpmTracker: TPMTracker;
  private readonly metricsCollector: BackendMetricsCollector;

  private isBackendHealthy(profileName: string): boolean {
    return this.circuitBreaker.isBackendHealthy(profileName);
  }

  private canAttemptBackend(profileName: string): boolean {
    return this.circuitBreaker.canAttemptBackend(profileName);
  }
  private recordBackendSuccess(profileName: string): void {
    this.circuitBreaker.recordBackendSuccess(profileName);
  }

  private recordBackendFailure(profileName: string, error: Error): void {
    this.circuitBreaker.recordBackendFailure(profileName, error);
  }

  /**
   * Wrap iterator with timeout for first chunk
   * @plan PLAN-20251212issue489 - Phase 3
   */
  private async *wrapWithTimeout(
    iterator: AsyncIterableIterator<IContent>,
    timeoutMs: number | undefined,
    profileName: string,
  ): AsyncGenerator<IContent> {
    yield* wrapWithFirstChunkTimeout(
      iterator,
      timeoutMs,
      profileName,
      this.logger,
    );
  }

  private isTimeoutError(error: unknown): boolean {
    return isTimeoutError(error);
  }

  /**
   * Update TPM tracking with new tokens
   * @plan PLAN-20251212issue489 - Phase 4
   */
  private updateTPM(profileName: string, tokensUsed: number): void {
    this.tpmTracker.updateTPM(profileName, tokensUsed);
  }

  private calculateTPM(profileName: string): number {
    return this.tpmTracker.calculateTPM(profileName);
  }

  private shouldSkipOnTPM(
    profileName: string,
    tpmThreshold: number | undefined,
  ): boolean {
    return this.tpmTracker.shouldSkipOnTPM(profileName, tpmThreshold);
  }

  private extractTokenCount(chunks: IContent[]): number {
    return BackendMetricsCollector.extractTokenCount(chunks);
  }

  private recordRequestStart(profileName: string): number {
    return this.metricsCollector.recordRequestStart(profileName);
  }

  private recordRequestSuccess(
    profileName: string,
    startTime: number,
    tokensUsed: number,
  ): void {
    this.metricsCollector.recordRequestSuccess(
      profileName,
      startTime,
      tokensUsed,
    );
  }

  private recordRequestFailure(
    profileName: string,
    startTime: number,
    error: Error,
  ): void {
    this.metricsCollector.recordRequestFailure(
      profileName,
      startTime,
      this.isTimeoutError(error),
    );
  }

  /**
   * Execute with failover strategy
   * @plan PLAN-20251212issue488
   * @plan PLAN-20251212issue489 - Phase 2: Updated with circuit breaker integration
   * @plan PLAN-20251217issue902 - Sticky failover: start from last successful backend
   */
  private async *executeWithFailover(
    options: GenerateChatOptions,
  ): AsyncGenerator<IContent> {
    const settings = this.extractFailoverSettings();
    const errors: Array<{ profile: string; error: Error }> = [];
    const numProfiles = this.config.subProfiles.length;
    const contextLimitErrors: Array<{ profile: string; error: Error }> = [];

    // Check if all backends are unhealthy (circuit breakers open)
    this.validateNotAllUnhealthy(settings, numProfiles);

    // Start from currentFailoverIndex and iterate through all backends (Issue #902)
    let visitedCount = 0;
    let currentIndex = this.currentFailoverIndex;

    while (visitedCount < numProfiles) {
      const subProfile = this.config.subProfiles[currentIndex];
      visitedCount++;

      // Skip unhealthy backends (circuit breaker + TPM checks)
      if (this.shouldSkipBackend(subProfile.name, settings)) {
        currentIndex = (currentIndex + 1) % numProfiles;
        continue;
      }

      const succeeded = yield* this.tryBackendWithRetries(
        subProfile,
        options,
        settings,
        errors,
        contextLimitErrors,
        currentIndex,
        numProfiles,
      );
      if (succeeded) {
        return;
      }

      // Move to next backend (circular iteration)
      currentIndex = (currentIndex + 1) % numProfiles;
    }

    if (errors.length === 0 && contextLimitErrors.length > 0) {
      throw new LoadBalancerAllContextLimitsExceededError({
        profileName: this.config.profileName,
        failures: contextLimitErrors.map(({ profile, error }) => ({
          profile,
          error,
        })),
      });
    }

    throw new LoadBalancerFailoverError(this.config.profileName, [
      ...errors,
      ...contextLimitErrors,
    ]);
  }

  private shouldSkipBackend(
    profileName: string,
    settings: FailoverSettings,
  ): boolean {
    if (!this.isBackendHealthy(profileName)) {
      this.logger.debug(
        () =>
          `[LB:failover] Skipping unhealthy backend: ${profileName} (circuit breaker open)`,
      );
      return true;
    }

    if (this.shouldSkipOnTPM(profileName, settings.tpmThreshold)) {
      this.logger.debug(
        () =>
          `[LB:failover] Skipping backend: ${profileName} (TPM below threshold)`,
      );
      return true;
    }

    return false;
  }

  /**
   * Validate that not all backends are unhealthy (circuit breakers open).
   */
  private validateNotAllUnhealthy(
    settings: FailoverSettings,
    numProfiles: number,
  ): void {
    if (settings.circuitBreakerEnabled) {
      const allUnhealthy = this.config.subProfiles
        .slice(0, numProfiles)
        .every((sp) => !this.canAttemptBackend(sp.name));
      if (allUnhealthy) {
        throw new Error(
          'All backends are currently unhealthy (circuit breakers open). Please wait for recovery or check backend configurations.',
        );
      }
    }
  }

  /**
   * Try a single backend with retry logic, yielding chunks on success.
   * Handles immediate failover errors and retryable errors.
   */
  private async *tryBackendWithRetries(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
    settings: FailoverSettings,
    errors: Array<{ profile: string; error: Error }>,
    contextLimitErrors: Array<{ profile: string; error: Error }>,
    currentIndex: number,
    numProfiles: number,
  ): AsyncGenerator<IContent, boolean> {
    let attempts = 0;
    const maxAttempts = Math.max(1, settings.retryCount);

    while (attempts < maxAttempts) {
      attempts++;
      let startTime = 0;
      let requestStarted = false;
      const chunksYielded = { value: false };
      try {
        const enforcedOptions = await this.enforceTokenLimitForTarget(
          options,
          subProfile,
        );
        startTime = this.recordRequestStart(subProfile.name);
        requestStarted = true;
        yield* this.attemptBackendRequest(
          subProfile,
          enforcedOptions,
          settings,
          startTime,
          chunksYielded,
        );
        this.currentFailoverIndex = 0;
        return true;
      } catch (error) {
        if (error instanceof LoadBalancerCompressionCallbackError) {
          throw error;
        }
        if (error instanceof LoadBalancerContextLimitError) {
          contextLimitErrors.push({ profile: subProfile.name, error });
          this.currentFailoverIndex = (currentIndex + 1) % numProfiles;
          return false;
        }
        if (!requestStarted) {
          errors.push({
            profile: subProfile.name,
            error: error instanceof Error ? error : new Error(String(error)),
          });
          this.currentFailoverIndex = (currentIndex + 1) % numProfiles;
          return false;
        }
        const handled = this.handleFailoverError(
          error,
          subProfile,
          startTime,
          attempts,
          maxAttempts,
          settings,
          errors,
          chunksYielded.value,
          currentIndex,
          numProfiles,
        );
        if (handled === 'immediate-throw') {
          throw error;
        }
        if (handled === 'break') {
          // Exit the retry while-loop. This generator returns,
          // causing the outer executeWithFailover while-loop's
          // yield* to complete normally. Control then continues
          // with the next backend in the outer loop.
          break;
        }
        // 'retry' — apply delay then loop
        if (settings.retryDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, settings.retryDelayMs),
          );
        }
      }
    }
    return false;
  }

  /**
   * Execute a single request attempt against a backend, yielding chunks.
   */
  private async *attemptBackendRequest(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
    settings: FailoverSettings,
    startTime: number,
    chunksYielded: { value: boolean },
  ): AsyncGenerator<IContent> {
    this.logger.debug(
      () =>
        `[LB:failover] Trying backend: ${subProfile.name} (start time: ${startTime})`,
    );

    const resolvedOptions = this.buildResolvedOptions(subProfile, options);
    const delegateProvider = this.providerManager.getProviderByName(
      subProfile.providerName,
    );
    if (!delegateProvider) {
      throw new Error(`Provider "${subProfile.providerName}" not found`);
    }

    const rawIterator =
      delegateProvider.generateChatCompletion(resolvedOptions);
    const iterator = this.wrapWithTimeout(
      rawIterator,
      settings.timeoutMs,
      subProfile.name,
    );

    const chunks: IContent[] = [];
    for await (const chunk of iterator) {
      chunksYielded.value = true;
      chunks.push(chunk);
      yield chunk;
    }

    const tokensUsed = this.extractTokenCount(chunks);
    if (tokensUsed > 0) {
      this.updateTPM(subProfile.name, tokensUsed);
    }

    this.recordRequestSuccess(subProfile.name, startTime, tokensUsed);
    this.incrementStats(subProfile.name);
    this.recordBackendSuccess(subProfile.name);
    this.logger.debug(
      () => `[LB:failover] Success on backend: ${subProfile.name}`,
    );
  }

  /**
   * Handle error during failover attempt. Returns action:
   * - 'immediate-throw': re-throw the error (chunks already yielded or abort)
   * - 'break': stop retrying this backend, move to next
   * - 'retry': continue the retry loop
   */
  private handleFailoverError(
    error: unknown,
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    startTime: number,
    attempts: number,
    maxAttempts: number,
    settings: FailoverSettings,
    errors: Array<{ profile: string; error: Error }>,
    chunksYielded: boolean,
    currentIndex: number,
    numProfiles: number,
  ): 'immediate-throw' | 'break' | 'retry' {
    if (this.isImmediateFailoverError(error)) {
      if (chunksYielded) {
        this.logger.debug(
          () =>
            `[LB:failover] ${subProfile.name} returned immediate failover error after yielding chunks, aborting stream`,
        );
        this.recordRequestFailure(subProfile.name, startTime, error as Error);
        this.recordBackendFailure(subProfile.name, error as Error);
        return 'immediate-throw';
      }

      this.logger.debug(
        () =>
          `[LB:failover] ${subProfile.name} returned immediate failover error (${getErrorStatus(error)}), skipping retries`,
      );
      this.recordRequestFailure(subProfile.name, startTime, error as Error);
      this.recordBackendFailure(subProfile.name, error as Error);
      errors.push({ profile: subProfile.name, error: error as Error });
      this.currentFailoverIndex = (currentIndex + 1) % numProfiles;
      return 'break';
    }

    const isLastAttempt = attempts >= maxAttempts;
    const shouldRetry = !isLastAttempt && this.shouldFailover(error, settings);

    if (shouldRetry) {
      if (settings.retryDelayMs > 0) {
        this.logger.debug(
          () =>
            `[LB:failover] ${subProfile.name} attempt ${attempts} failed, retrying after ${settings.retryDelayMs}ms: ${(error as Error).message}`,
        );
      }
      return 'retry';
    }

    this.logger.debug(
      () =>
        `[LB:failover] ${subProfile.name} failed after ${attempts} attempts: ${(error as Error).message}`,
    );
    this.recordRequestFailure(subProfile.name, startTime, error as Error);
    this.recordBackendFailure(subProfile.name, error as Error);
    errors.push({ profile: subProfile.name, error: error as Error });
    this.currentFailoverIndex = (currentIndex + 1) % numProfiles;
    return 'break';
  }

  /**
   * Get auth token - required by ProviderManager.normalizeRuntimeInputs validation.
   * The load-balancer does not use this token directly; it passes authToken via
   * options.resolved to the delegate provider. This method exists to satisfy
   * ProviderManager's auth-resolution check before delegation can happen.
   */
  async getAuthToken(): Promise<string> {
    const firstSubProfile = this.config.subProfiles[0];
    return firstSubProfile.authToken ?? '';
  }
}
