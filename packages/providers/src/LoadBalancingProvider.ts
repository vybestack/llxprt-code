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
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { LoadBalancerFailoverError } from './errors.js';
import { getAttemptLifecycleObserver } from './logging/attemptLifecycle.js';
import {
  notifyBackendStart,
  yieldWithBackendMetrics,
  type BackendAttemptLifecycleState,
  type BackendMetricsHooks,
} from './loadBalancing/backendLifecycleNotifier.js';
import {
  markProviderErrorObservationHandled,
  withProviderErrorObservationContext,
} from './providerErrorObservation.js';
import { CircuitBreakerManager } from './loadBalancing/circuitBreakerManager.js';
import { TPMTracker } from './loadBalancing/tpmTracker.js';
import { BackendMetricsCollector } from './loadBalancing/backendMetrics.js';
import { extractFailoverSettings as extractFailoverSettingsFromEphemeral } from './loadBalancing/failoverSettings.js';
import { isTimeoutError } from './loadBalancing/streamTimeout.js';
import { buildExtendedStats } from './loadBalancing/statsBuilder.js';
import { buildRoundRobinResolvedOptions as buildRoundRobinResolvedOptionsExternal } from './loadBalancing/resolvedOptionsBuilder.js';
import { cloneContentsForCompression } from './loadBalancing/contentClone.js';
import {
  getRequestSignal,
  rethrowIfAborted,
} from './loadBalancing/requestAbort.js';
import { optionsWithSelectedModelPrompt } from './loadBalancing/selectedModelPrompt.js';
import { hasTransportAttemptRemaining } from './transportAttemptBudget.js';
import { isRequestCommitted } from './retryRequestContext.js';
import { requireTransportAttempt } from './loadBalancing/delegateAttempt.js';
import { executeBackendAttempt } from './loadBalancing/backendAttemptExecutor.js';
import {
  observeDelegateFailure,
  recordBackendFailure,
  shouldSkipBackend,
  validateNotAllUnhealthy,
} from './loadBalancing/backendRuntime.js';
import {
  LoadBalancerAllContextLimitsExceededError,
  LoadBalancerCompressionCallbackError,
  LoadBalancerContextLimitError,
} from './loadBalancing/contextLimitError.js';
import { handleFailoverError as handleFailoverErrorFn } from './loadBalancing/failoverErrorHandler.js';
import type { EstimationResult } from './loadBalancing/loadBalancerTokenEstimator.js';
import {
  estimatePreparedPrompt,
  optionsWithPromptProjection,
} from './loadBalancing/preparedPromptOptions.js';
import { getTargetContextLimit } from './loadBalancing/targetContextLimit.js';
import {
  getMinMemberContextWindow,
  resolveSubProfileModel,
} from './loadBalancing/subProfileHelpers.js';
import type { TokenAccountingDiagnostics } from './loadBalancing/tokenAccountingDiagnostics.js';
import { validateLoadBalancerConfig } from './loadBalancing/configValidation.js';
import { FailoverState } from './loadBalancing/failoverState.js';
import {
  isResolvedSubProfile,
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

interface PreparedLoadBalancerTarget {
  readonly options: GenerateChatOptions;
  readonly delegateProvider: IProvider;
}

function normalizeGenerateChatOptions(
  options: GenerateChatOptions,
): GenerateChatOptions {
  const runtimeOptions: Partial<GenerateChatOptions> = options;
  return runtimeOptions.contents === undefined
    ? { ...options, contents: [] }
    : options;
}

/**
 * Load balancing provider that distributes requests across multiple sub-profiles
 */
export class LoadBalancingProvider implements IProvider {
  readonly name = 'load-balancer';
  readonly transportAttemptOwnership = 'provider' as const;
  private roundRobinIndex = 0;
  private readonly logger = new DebugLogger('llxprt:providers:load-balancer');
  private stats: Map<string, number> = new Map();
  private lastSelected: string | null = null;
  private totalRequests = 0;
  private circuitBreakerStates: Map<string, CircuitBreakerState> = new Map();
  private tpmBuckets: Map<number, Map<string, number>> = new Map();
  private backendMetrics: Map<string, BackendMetrics> = new Map();
  private readonly failoverState = new FailoverState();
  private compressionCallback: CompressionCallback | null = null;
  private accountingSource: string | null = null;
  private lastEstimatedTokens: number | null = null;
  private diagnosticsSelectedSubProfile: string | null = null;
  private diagnosticsActiveProvider: string | null = null;
  private diagnosticsActiveModel: string | null = null;
  /** Monotonic counter for LB-level backend attempt IDs */
  private lbAttemptCounter = 0;

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
    validateLoadBalancerConfig(config);
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

  getContextLimit(): number | undefined {
    return this.getEffectiveContextLimit();
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
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    resolvedOptions: GenerateChatOptions,
    delegateProvider: IProvider,
  ): Promise<EstimationResult> {
    const model = resolveSubProfileModel(subProfile);
    const result = await estimatePreparedPrompt(
      subProfile,
      resolvedOptions,
      delegateProvider,
      this.providerManager.getTokenizerFactory(),
    );
    this.accountingSource = result.source;
    this.lastEstimatedTokens = result.tokens;
    this.diagnosticsSelectedSubProfile = subProfile.name;
    this.diagnosticsActiveProvider = subProfile.providerName;
    this.diagnosticsActiveModel = model || null;
    return result;
  }

  private async compressForContextLimit(
    options: GenerateChatOptions,
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    result: EstimationResult,
    contextLimit: number,
    delegateProvider: IProvider,
  ): Promise<GenerateChatOptions | undefined> {
    if (this.compressionCallback === null) return undefined;
    this.logger.debug(
      () =>
        `[LB:token-guard] Estimate ${result.tokens} exceeds limit ${contextLimit} for ${subProfile.name}, attempting compression`,
    );
    const clonedContents = this.cloneForCompression(
      options.contents,
      subProfile,
      result,
      contextLimit,
    );
    let compressed: IContent[];
    try {
      compressed = await this.compressionCallback(clonedContents);
    } catch (error) {
      throw new LoadBalancerCompressionCallbackError({
        profileName: this.config.profileName,
        subProfileName: subProfile.name,
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
    const compressedOptions = { ...options, contents: compressed };
    const compressedResult = await this.estimateForSubProfile(
      subProfile,
      this.buildDelegateResolvedOptions(subProfile, compressedOptions),
      delegateProvider,
    );
    if (compressedResult.tokens <= contextLimit) {
      return optionsWithPromptProjection(compressedOptions, compressedResult);
    }
    return undefined;
  }

  private cloneForCompression(
    contents: IContent[],
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    result: EstimationResult,
    contextLimit: number,
  ): IContent[] {
    try {
      return cloneContentsForCompression(contents);
    } catch (error) {
      throw new LoadBalancerContextLimitError({
        profileName: this.config.profileName,
        subProfileName: subProfile.name,
        tokens: result.tokens,
        contextLimit,
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Enforce the target context limit for a sub-profile, attempting compression
   * before throwing when the estimate exceeds the limit.
   * @plan PLAN-2207-LB-TOKEN-ACCOUNTING
   */
  private async enforceTokenLimitForTarget(
    options: GenerateChatOptions,
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  ): Promise<PreparedLoadBalancerTarget> {
    const sharedLimit = this.getEffectiveContextLimit();
    const contextLimit = getTargetContextLimit(subProfile, sharedLimit);
    const delegateProvider = this.providerManager.getProviderByName(
      subProfile.providerName,
    );
    if (!delegateProvider) {
      const errorMsg = `Provider "${subProfile.providerName}" not found for sub-profile "${subProfile.name}"`;
      this.logger.error(() => errorMsg);
      throw new Error(errorMsg);
    }
    // Re-render the caller-assembled system prompt for the model this router
    // selected, so the rendered model matches resolved.model (issue #3157).
    // Runs before estimation/compression so the LB accounts for the prompt it
    // actually transmits.
    const targetOptions = await optionsWithSelectedModelPrompt(
      options,
      subProfile.providerName,
      resolveSubProfileModel(subProfile),
    );
    const resolvedOptions = this.buildDelegateResolvedOptions(
      subProfile,
      targetOptions,
    );
    const result = await this.estimateForSubProfile(
      subProfile,
      resolvedOptions,
      delegateProvider,
    );
    if (contextLimit === undefined || result.tokens <= contextLimit) {
      return {
        options: optionsWithPromptProjection(targetOptions, result),
        delegateProvider,
      };
    }
    const compressed = await this.compressForContextLimit(
      targetOptions,
      subProfile,
      result,
      contextLimit,
      delegateProvider,
    );
    if (compressed !== undefined) {
      return { options: compressed, delegateProvider };
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
      options = normalizeGenerateChatOptions(optionsOrContent);
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

    const preparedTarget = await this.enforceTokenLimitForTarget(
      options,
      subProfile,
    );

    this.incrementStats(subProfile.name);
    const startTime = this.metricsCollector.recordRequestStart(subProfile.name);
    const { delegateProvider } = preparedTarget;

    this.logger.debug(
      () =>
        `Delegating to provider: ${delegateProvider.name} (sub-profile: ${subProfile.name})`,
    );

    const resolvedOptions = this.buildRoundRobinResolvedOptions(
      subProfile,
      preparedTarget.options,
    );
    requireTransportAttempt(resolvedOptions);

    const { lifecycleObserver, attemptCtx } = this.startBackendAttempt(
      resolvedOptions,
      subProfile,
      0,
    );

    yield* yieldWithBackendMetrics(
      delegateProvider,
      resolvedOptions,
      subProfile,
      startTime,
      this.getMetricsHooks(),
      lifecycleObserver,
      attemptCtx,
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

  private getMetricsHooks(): BackendMetricsHooks {
    return {
      updateTPM: (name, tokens) => this.tpmTracker.updateTPM(name, tokens),
      recordRequestSuccess: (name, start, tokens) =>
        this.metricsCollector.recordRequestSuccess(name, start, tokens),
      recordRequestFailure: (name, start, err) =>
        this.metricsCollector.recordRequestFailure(
          name,
          start,
          isTimeoutError(err),
        ),
    };
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
   * Report the effective model for the currently selected sub-profile so the
   * agent/UI layer never falls back to a top-level default (e.g. Gemini) for a
   * load-balancer profile. Before any selection, falls back to the first
   * sub-profile model.
   */
  getCurrentModel(): string {
    if (this.lastSelected !== null) {
      const selected = this.config.subProfiles.find(
        (candidate) => candidate.name === this.lastSelected,
      );
      if (selected !== undefined) {
        return resolveSubProfileModel(selected);
      }
    }
    return this.getDefaultModel();
  }

  /**
   * Mark a sub-profile as the active selection. This is the UI-refresh trigger:
   * it updates `lastSelected` and emits LoadBalancerSelectionChanged whenever the
   * active backend changes, so the status footer can recompute
   * `lb:<lb>:<sub>:<model>` the moment a backend is chosen — independent of
   * whether the request ultimately succeeds. Both strategies call this as soon
   * as they pick a backend (round-robin before delegating, failover when it
   * selects/attempts each backend), so a failing primary is announced too.
   */
  private markActiveSelection(subProfileName: string): void {
    const selectionChanged = this.lastSelected !== subProfileName;
    this.lastSelected = subProfileName;
    if (selectionChanged) {
      this.emitSelectionChanged(subProfileName);
    }
  }

  /**
   * Record a successful request for a sub-profile (success accounting only).
   * Selection marking/emission is handled by markActiveSelection so it also
   * fires for failover backends that are tried before this success path.
   * Phase 5: Stats Integration
   */
  private incrementStats(subProfileName: string): void {
    this.markActiveSelection(subProfileName);
    this.stats.set(subProfileName, (this.stats.get(subProfileName) ?? 0) + 1);
    this.totalRequests++;
  }

  /**
   * Notify the rest of the app that the active sub-profile changed so the
   * status footer can recompute the load-balancer identity
   * (`lb:<lb>:<sub>:<model>`). This emits a dedicated
   * LoadBalancerSelectionChanged event (NOT ModelChanged): a sub-profile
   * rotation is a UI-refresh trigger, not an actual model switch, so it must
   * not be conflated with real model changes by other subscribers.
   */
  private emitSelectionChanged(subProfileName: string): void {
    try {
      const subProfile = this.config.subProfiles.find(
        (candidate) => candidate.name === subProfileName,
      );
      const model = subProfile ? resolveSubProfileModel(subProfile) : null;
      coreEvents.emitLoadBalancerSelectionChanged({
        profileName: this.config.profileName,
        subProfileName,
        model,
      });
    } catch (error) {
      this.logger.debug(
        () => `Failed to emit load-balancer selection trigger: ${error}`,
      );
    }
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
      (name) => this.tpmTracker.calculateTPM(name),
    );
  }

  /**
   * Exposes the load-balancer configuration so profile persistence can
   * serialize the ACTIVE load balancer back into a genuine
   * type:'loadbalancer' profile. Without this, saving a profile while a
   * load balancer is active snapshots the virtual provider name
   * ('load-balancer') into a standard profile — a corrupt file that can
   * never be re-applied because 'load-balancer' is not a registered
   * provider at load time (issue #2479).
   */
  getLoadBalancerConfig(): Readonly<LoadBalancingProviderConfig> {
    return this.config;
  }

  /**
   * Returns the base URL of the last-selected sub-profile, or undefined if
   * no sub-profile has been selected yet or the sub-profile has no explicit
   * base URL. Used by stamping logic so that turns generated by load-balanced
   * backends carry the actual endpoint that produced them — enabling
   * cross-endpoint thinking-block stripping when a load balancer rotates
   * between Anthropic-compatible endpoints (e.g. z.ai and native Anthropic).
   */
  getLastSelectedBaseUrl(): string | undefined {
    if (!this.lastSelected) return undefined;
    const subProfile = this.config.subProfiles.find(
      (candidate) => candidate.name === this.lastSelected,
    );
    return subProfile?.baseURL;
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
    return this.failoverState.getIndex();
  }

  /**
   * Reset failover index to 0 (for testing)
   * @plan PLAN-20251217issue902 - Sticky failover behavior
   */
  resetFailoverIndex(): void {
    this.failoverState.reset();
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

  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly tpmTracker: TPMTracker;
  private readonly metricsCollector: BackendMetricsCollector;

  /**
   * Execute with failover strategy
   * @plan PLAN-20251212issue488
   * @plan PLAN-20251212issue489 - Phase 2: Updated with circuit breaker integration
   * @plan PLAN-20251217issue902 - Sticky failover: start from last successful backend
   */
  private async *executeWithFailover(
    options: GenerateChatOptions,
  ): AsyncGenerator<IContent> {
    yield* withProviderErrorObservationContext(options, (observedOptions) =>
      this.executeObservedFailover(observedOptions),
    );
  }

  private async *executeObservedFailover(
    options: GenerateChatOptions,
  ): AsyncGenerator<IContent> {
    const { owner: requestOwner, startIndex } = this.failoverState.claim();
    const settings = this.extractFailoverSettings();
    const errors: Array<{ profile: string; error: Error }> = [];
    const numProfiles = this.config.subProfiles.length;
    const contextLimitErrors: Array<{ profile: string; error: Error }> = [];

    this.logger.debug(
      () =>
        `[LB:failover] Starting failover rotation from index ${startIndex} (${this.config.subProfiles[startIndex]?.name ?? 'unknown'}) with ${numProfiles} backends`,
    );

    // Check if all backends are unhealthy (circuit breakers open)
    validateNotAllUnhealthy(
      settings.circuitBreakerEnabled,
      this.config.subProfiles
        .slice(0, numProfiles)
        .map((profile) => profile.name),
      (name) => this.circuitBreaker.canAttemptBackend(name),
    );

    // Start from currentFailoverIndex and iterate through all backends (Issue #902)
    let visitedCount = 0;
    let currentIndex = startIndex;

    while (
      visitedCount < numProfiles &&
      hasTransportAttemptRemaining(options)
    ) {
      const subProfile = this.config.subProfiles[currentIndex];
      visitedCount++;

      // Skip unhealthy backends (circuit breaker + TPM checks)
      if (
        shouldSkipBackend(
          subProfile.name,
          settings.tpmThreshold,
          (name) => this.circuitBreaker.isBackendHealthy(name),
          (name, threshold) => this.tpmTracker.shouldSkipOnTPM(name, threshold),
          this.logger,
        )
      ) {
        currentIndex = (currentIndex + 1) % numProfiles;
        continue;
      }

      this.logger.debug(
        () =>
          `[LB:failover] Attempting backend at index ${currentIndex}: ${subProfile.name}`,
      );

      const succeeded = yield* this.tryBackendWithRetries(
        subProfile,
        options,
        settings,
        errors,
        contextLimitErrors,
        currentIndex,
        numProfiles,
        requestOwner,
      );
      if (succeeded) {
        return;
      }

      // Move to next backend (circular iteration)
      currentIndex = (currentIndex + 1) % numProfiles;
    }

    this.failoverState.setIfOwner(requestOwner, 0);

    if (errors.length === 0 && contextLimitErrors.length > 0) {
      const aggregate = new LoadBalancerAllContextLimitsExceededError({
        profileName: this.config.profileName,
        failures: contextLimitErrors.map(({ profile, error }) => ({
          profile,
          error,
        })),
      });
      markProviderErrorObservationHandled(options, aggregate);
      throw aggregate;
    }

    const aggregate = new LoadBalancerFailoverError(this.config.profileName, [
      ...errors,
      ...contextLimitErrors,
    ]);
    markProviderErrorObservationHandled(options, aggregate);
    throw aggregate;
  }

  private async *tryBackendWithRetries(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
    settings: FailoverSettings,
    errors: Array<{ profile: string; error: Error }>,
    contextLimitErrors: Array<{ profile: string; error: Error }>,
    currentIndex: number,
    numProfiles: number,
    requestOwner: symbol,
  ): AsyncGenerator<IContent, boolean> {
    let attempts = 0;
    const maxAttempts = Math.max(1, settings.retryCount);
    while (attempts < maxAttempts && hasTransportAttemptRemaining(options)) {
      attempts++;
      let startTime = 0;
      let requestStarted = false;
      const chunksYielded = { value: false };
      try {
        const preparedTarget = await this.enforceTokenLimitForTarget(
          options,
          subProfile,
        );
        startTime = this.metricsCollector.recordRequestStart(subProfile.name);
        requestStarted = true;
        yield* this.attemptBackendRequest(
          subProfile,
          preparedTarget.options,
          preparedTarget.delegateProvider,
          settings,
          startTime,
          chunksYielded,
          attempts - 1,
        );
        this.failoverState.setIfOwner(requestOwner, currentIndex);
        return true;
      } catch (error) {
        rethrowIfAborted(error, options);
        observeDelegateFailure(options, error, this.logger);
        if (
          error instanceof LoadBalancerCompressionCallbackError ||
          error instanceof LoadBalancerContextLimitError
        ) {
          contextLimitErrors.push({ profile: subProfile.name, error });
          return this.failoverState.advanceFrom(
            requestOwner,
            currentIndex,
            numProfiles,
          );
        }
        if (!requestStarted) {
          recordBackendFailure(errors, subProfile.name, error);
          return this.failoverState.advanceFrom(
            requestOwner,
            currentIndex,
            numProfiles,
          );
        }
        const handled = this.handleFailoverError(
          error,
          subProfile,
          startTime,
          attempts,
          maxAttempts,
          settings,
          errors,
          chunksYielded.value || isRequestCommitted(options),
          currentIndex,
          numProfiles,
          requestOwner,
          hasTransportAttemptRemaining(options),
        );
        if (handled === 'immediate-throw') throw error;
        if (handled === 'break') break;
        if (settings.retryDelayMs > 0) {
          await delay(settings.retryDelayMs, getRequestSignal(options));
        }
      }
    }
    return false;
  }

  private startBackendAttempt(
    options: GenerateChatOptions,
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    requestLocalAttemptIndex: number,
  ): BackendAttemptLifecycleState {
    const lifecycleObserver = getAttemptLifecycleObserver(options.metadata);
    // Global counter only provides ID uniqueness; the attemptIndex is
    // request-local so concurrent and later requests get correct indexes.
    const idSequence = this.lbAttemptCounter++;
    const attemptCtx = notifyBackendStart(
      lifecycleObserver,
      this.config.profileName,
      subProfile,
      requestLocalAttemptIndex,
      idSequence,
      this.logger,
      options,
    );
    return { lifecycleObserver, attemptCtx };
  }

  private async *attemptBackendRequest(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
    delegateProvider: IProvider,
    settings: FailoverSettings,
    startTime: number,
    chunksYielded: { value: boolean },
    requestLocalAttemptIndex: number,
  ): AsyncGenerator<IContent> {
    // Capture the lifecycle observer once so the start factory can emit
    // onAttemptStart at the right time (after setup passes).
    const lifecycleObserver = getAttemptLifecycleObserver(options.metadata);
    // Global counter only provides ID uniqueness; the attemptIndex is
    // request-local so concurrent and later requests get correct indexes.
    const idSequence = this.lbAttemptCounter++;

    yield* executeBackendAttempt({
      subProfile,
      options,
      delegateProvider,
      settings,
      startTime,
      chunksYielded,
      lifecycleObserver,
      startBackendAttempt: (resolvedOptions?: GenerateChatOptions) =>
        notifyBackendStart(
          lifecycleObserver,
          this.config.profileName,
          subProfile,
          requestLocalAttemptIndex,
          idSequence,
          this.logger,
          resolvedOptions ?? options,
        ),
      deps: {
        logger: this.logger,
        circuitBreaker: this.circuitBreaker,
        markActiveSelection: (name) => this.markActiveSelection(name),
        buildResolvedOptions: (sp, opt) => this.buildResolvedOptions(sp, opt),
        getMetricsHooks: () => this.getMetricsHooks(),
        incrementStats: (name) => this.incrementStats(name),
      },
    });
  }

  private recordFail(name: string, startTime: number, error: Error): void {
    this.metricsCollector.recordRequestFailure(
      name,
      startTime,
      isTimeoutError(error),
    );
  }

  private handleFailoverError(
    error: unknown,
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    startTime: number,
    attempts: number,
    maxAttempts: number,
    settings: FailoverSettings,
    errors: Array<{ profile: string; error: Error }>,
    requestCommitted: boolean,
    currentIndex: number,
    numProfiles: number,
    requestOwner: symbol,
    transportAttemptRemaining: boolean,
  ): 'immediate-throw' | 'break' | 'retry' {
    return handleFailoverErrorFn(
      error,
      subProfile,
      startTime,
      attempts,
      maxAttempts,
      settings,
      errors,
      requestCommitted,
      currentIndex,
      numProfiles,
      requestOwner,
      transportAttemptRemaining,
      {
        logger: this.logger,
        circuitBreaker: this.circuitBreaker,
        failoverState: this.failoverState,
        recordFail: (name, st, err) => this.recordFail(name, st, err),
      },
    );
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
