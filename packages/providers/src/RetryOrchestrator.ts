/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260128issue808
 * RetryOrchestrator - Centralized retry and bucket failover management
 *
 * This wrapper implements the "external retry orchestrator" pattern,
 * moving ALL retry logic out of individual providers into a single,
 * consistent implementation that handles:
 *
 * 1. Exponential backoff with jitter
 * 2. OAuth bucket failover
 * 3. Circuit breaker pattern (optional)
 * 4. Throttle wait time tracking
 * 5. Abort signal propagation
 *
 * Architecture:
 * - Providers throw immediately on errors (fast-fail)
 * - RetryOrchestrator handles all retry/backoff/failover logic
 * - Works with BucketFailoverHandler from config
 * - Respects ephemeral settings (retries, retrywait)
 */

import {
  type IProvider,
  type GenerateChatOptions,
  type ProviderToolset,
} from './IProvider.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IModel } from './IModel.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { BucketFailoverHandler } from '@vybestack/llxprt-code-core/config/config.js';
import { AllBucketsExhaustedError } from './errors.js';
import type { StructuredErrorCategory } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  createAbortError,
  delay,
} from '@vybestack/llxprt-code-core/utils/delay.js';
import { guardStream } from './guardedStream.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  claimProviderErrorObservation,
  invokeProviderErrorObserver,
  toObservedProviderError,
} from './providerErrorObservation.js';
import {
  delegateGetStats,
  delegateGetLoadBalancerConfig,
} from './loadBalancing/wrappedProviderDelegation.js';
import {
  createLinkedAbortController,
  getRequestSignal,
  raceWithAbort,
  withRequestSignal,
} from './utils/abortSignal.js';
import {
  resolveRetryRequestContext,
  getRequestCommitState,
  type RetryRequestContext,
} from './retryRequestContext.js';
import {
  accountProviderAttempt,
  beginProviderTransportAttempt,
  createInitialRetryState,
  providerOwnsTransportAttempts,
} from './retryTransportOwnership.js';
import { safeGetDefaultModel } from './utils/safeDefaultModel.js';
import {
  classifyRetryError,
  isTerminalRetryError,
  resetRetryErrorCounters,
  updateRetryErrorCounters,
} from './retryErrorClassification.js';
import { decodeRetryFailure } from './retryFailureTaxonomy.js';
import type { TransportAttemptBudget } from './transportAttemptBudget.js';
import {
  attemptBucketFailover,
  shouldFailoverNow,
} from './retryFailoverLogic.js';
import { decideCommittedFailure } from './retryCommitGate.js';
import {
  createRetriesExhaustedError,
  throwIfEmptyStreamExhaustsBudget,
} from './retryExhaustion.js';
import {
  shouldRetryError,
  getDelayDuration,
  hasRetryAfterHeader,
} from './retryDelayPolicy.js';
import { getAttemptLifecycleObserver } from './logging/attemptLifecycle.js';
import type {
  AttemptLifecycleObserver,
  AttemptStatus,
} from './logging/attemptLifecycle.js';
import { AttemptNotificationContext } from './retryAttemptNotifier.js';
import type { AttemptFailureReport } from './retryLifecycleNotifier.js';
import {
  getBucketFailoverHandlerFromOptions,
  getOnAuthErrorHandlerFromOptions,
  hasAuthRecoveryHandler,
} from './retryConfigHandlers.js';
import { resolveAuthTokenFromOptions } from './retryAuthTokenResolver.js';
import { randomUUID } from 'node:crypto';

function extractSignal(options: GenerateChatOptions): AbortSignal | undefined {
  return getRequestSignal(options);
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export interface RetryOrchestratorConfig {
  /** Maximum retry attempts (default: 6) */
  maxAttempts?: number;
  /** Initial delay in ms before first retry (default: 5000) */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelayMs?: number;
  /** Enable circuit breaker pattern (default: false) */
  circuitBreakerEnabled?: boolean;
  /** Number of failures before opening circuit (default: 3) */
  circuitBreakerFailureThreshold?: number;
  /** Time window for counting failures in ms (default: 60000) */
  circuitBreakerFailureWindowMs?: number;
  /** Time to wait before testing recovery in ms (default: 30000) */
  circuitBreakerRecoveryTimeoutMs?: number;
  /** Timeout for first chunk in streaming mode in ms (optional) */
  streamingTimeoutMs?: number;
  /** Timeout for blocking OAuth reauthentication during bucket failover in ms (default: 30000) */
  authRetryTimeoutMs?: number;
  /** Callback to track throttle wait time for metrics */
  trackThrottleWaitTime?: (waitTimeMs: number) => void;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: Array<{ timestamp: number; error: Error }>;
  openedAt?: number;
  lastAttempt?: number;
}

/**
 * RetryOrchestrator wraps a provider to add centralized retry, backoff,
 * and bucket failover logic. This enables the "fast-fail" pattern where
 * providers throw immediately on errors and the orchestrator handles retries.
 */
export class RetryOrchestrator implements IProvider {
  readonly name: string;
  readonly wrappedProvider: IProvider;
  private readonly logger = new DebugLogger('llxprt:retry:orchestrator');
  private readonly config: Required<RetryOrchestratorConfig>;
  // Circuit breaker state - reserved for future implementation
  // private circuitBreakerStates: Map<string, CircuitBreakerState> = new Map();

  constructor(provider: IProvider, config?: RetryOrchestratorConfig) {
    this.wrappedProvider = provider;
    this.name = provider.name;

    // Apply defaults
    this.config = {
      maxAttempts: config?.maxAttempts ?? 6,
      initialDelayMs: config?.initialDelayMs ?? 5000,
      maxDelayMs: config?.maxDelayMs ?? 30000,
      circuitBreakerEnabled: config?.circuitBreakerEnabled ?? false,
      circuitBreakerFailureThreshold:
        config?.circuitBreakerFailureThreshold ?? 3,
      circuitBreakerFailureWindowMs:
        config?.circuitBreakerFailureWindowMs ?? 60000,
      circuitBreakerRecoveryTimeoutMs:
        config?.circuitBreakerRecoveryTimeoutMs ?? 30000,
      streamingTimeoutMs: config?.streamingTimeoutMs ?? 0,
      authRetryTimeoutMs: config?.authRetryTimeoutMs ?? 30000,
      trackThrottleWaitTime: config?.trackThrottleWaitTime ?? (() => {}),
    };
  }

  // Delegate all IProvider methods to wrapped provider

  async getModels(): Promise<IModel[]> {
    return this.wrappedProvider.getModels();
  }

  getDefaultModel(): string {
    return safeGetDefaultModel(this.wrappedProvider);
  }

  getCurrentModel?(): string {
    return this.wrappedProvider.getCurrentModel?.() ?? '';
  }

  getToolFormat?(): string {
    return this.wrappedProvider.getToolFormat?.() ?? '';
  }

  isPaidMode?(): boolean {
    return this.wrappedProvider.isPaidMode?.() ?? false;
  }

  getServerTools(): string[] {
    return this.wrappedProvider.getServerTools();
  }

  async invokeServerTool(
    toolName: string,
    params: unknown,
    config?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.wrappedProvider.invokeServerTool(
      toolName,
      params,
      config,
      signal,
    );
  }

  getModelParams?(): Record<string, unknown> | undefined {
    return this.wrappedProvider.getModelParams?.();
  }

  getContextLimit?(): number | undefined {
    return this.wrappedProvider.getContextLimit?.();
  }

  clearAuthCache?(): void {
    this.wrappedProvider.clearAuthCache?.();
  }

  clearAuth?(): void {
    this.wrappedProvider.clearAuth?.();
  }

  /**
   * Delegate projectPromptEnvelope to the wrapped provider so the
   * prompt-envelope estimation capability is visible through the wrapper chain
   * (issue #2817, finding #1). Without this delegation, ProviderManager
   * returns a wrapped provider that hides the capability from the agent layer.
   *
   * Resolves to `undefined` when the wrapped provider does not implement the
   * seam. Because ProviderManager wraps EVERY provider, throwing here would
   * break sends for every out-of-scope protocol (Gemini, OpenAI-Vercel,
   * load-balanced providers); absence of the capability is a normal state,
   * not an error.
   */
  async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection | undefined> {
    return this.wrappedProvider.projectPromptEnvelope?.(options);
  }

  /**
   * Delegate getStats() to the wrapped provider when supported (e.g.
   * LoadBalancingProvider). Without this passthrough the footer and
   * diagnostics read stats through the wrapper chain and receive undefined,
   * because this orchestrator sits between LoggingProviderWrapper and the
   * underlying provider.
   */
  getStats(): unknown {
    return delegateGetStats(this.wrappedProvider);
  }

  /**
   * Delegate getLoadBalancerConfig() to the wrapped provider when supported
   * (LoadBalancingProvider), so profile persistence can serialize the active
   * load balancer through the wrapper chain (issue #2479).
   */
  getLoadBalancerConfig(): unknown {
    return delegateGetLoadBalancerConfig(this.wrappedProvider);
  }

  /**
   * Main method with retry orchestration logic
   * Supports both overloaded signatures accepted by the provider contract
   */
  generateChatCompletion(
    optionsOrContents: GenerateChatOptions | IContent[],
    tools?: ProviderToolset,
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent> {
    // Normalize arguments to GenerateChatOptions
    let options: GenerateChatOptions;

    if (Array.isArray(optionsOrContents)) {
      const legacyOptions: GenerateChatOptions = {
        contents: optionsOrContents,
        tools,
      };
      options =
        signal === undefined
          ? legacyOptions
          : withRequestSignal(legacyOptions, signal);
    } else {
      options =
        signal === undefined
          ? optionsOrContents
          : withRequestSignal(optionsOrContents, signal);
    }

    return this.generateChatCompletionWithRetry(options);
  }

  /**
   * Core retry orchestration logic
   */
  private async *generateChatCompletionWithRetry(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    if (options.metadata?.loadBalancerDelegate === true) {
      yield* this.wrappedProvider.generateChatCompletion(options);
      return;
    }
    const signal = extractSignal(options);
    if (isSignalAborted(signal)) throw createAbortError(signal?.reason);
    const request = resolveRetryRequestContext(options, this.config);
    try {
      yield* this.runRetryRequest(request, signal);
    } finally {
      request.releaseBudget();
    }
  }

  private createRetriesExhaustedError(
    lastError: unknown,
    budget: { used: number },
  ): Error {
    const finalError =
      lastError ?? new Error('Shared transport attempt budget exhausted');
    const { category, status } = classifyRetryError(finalError);
    return createRetriesExhaustedError(
      finalError,
      budget.used,
      category,
      status,
    );
  }

  private async *runRetryRequest(
    request: RetryRequestContext,
    signal: AbortSignal | undefined,
  ): AsyncIterableIterator<IContent> {
    const { maxAttempts, initialDelayMs, authRetryTimeoutMs, budget } = request;
    const requestOptions = request.options;
    const bucketFailoverHandler =
      getBucketFailoverHandlerFromOptions(requestOptions);
    const ownsAttempts = providerOwnsTransportAttempts(this.wrappedProvider);
    const lifecycleObserver = getAttemptLifecycleObserver(
      requestOptions.metadata,
    );
    const modelName =
      requestOptions.resolved?.model ??
      safeGetDefaultModel(this.wrappedProvider);
    let lastError: unknown;
    const retryState = createInitialRetryState(initialDelayMs);
    while (budget.used < budget.limit) {
      if (isSignalAborted(signal)) throw createAbortError(signal?.reason);
      request.recordTarget(this.name);
      const usedBefore = budget.used;
      const linked = createLinkedAbortController(signal);
      const attemptOptions = withRequestSignal(
        requestOptions,
        linked.controller.signal,
      );
      const notification = this.createAttemptNotification(
        lifecycleObserver,
        budget.used,
        modelName,
      );
      notification.maybeNotifyStart();
      let attemptError: unknown;
      let terminalStatus: AttemptStatus = 'aborted';
      try {
        yield* this.executeRawAttempt(
          ownsAttempts,
          request,
          attemptOptions,
          linked,
          retryState,
          bucketFailoverHandler,
          budget,
        );
        terminalStatus = 'success';
        return;
      } catch (error) {
        attemptError = error;
        lastError = error;
        terminalStatus = this.resolveTerminalStatus(error);
      } finally {
        this.finalizeAttempt(
          linked,
          attemptOptions,
          budget,
          usedBefore,
          notification,
          terminalStatus,
          attemptError,
          request,
        );
      }
      if (attemptError === undefined) continue;
      const action = await this.handleRetryError(
        attemptError,
        request,
        requestOptions,
        signal,
        retryState,
        maxAttempts,
        initialDelayMs,
        1,
        bucketFailoverHandler,
        authRetryTimeoutMs,
        budget,
      );
      if (action.type === 'throw') throw action.error;
    }

    throw this.createRetriesExhaustedError(lastError, budget);
  }

  private async *executeRawAttempt(
    ownsAttempts: boolean,
    request: RetryRequestContext,
    attemptOptions: GenerateChatOptions,
    linked: { controller: AbortController },
    retryState: {
      attempt: number;
      currentDelay: number;
      consecutive429s: number;
      consecutiveAuthErrors: number;
      consecutiveNetworkErrors: number;
      consecutiveServerErrors: number;
    },
    bucketFailoverHandler: BucketFailoverHandler | undefined,
    budget: { used: number; limit: number },
  ): AsyncIterableIterator<IContent> {
    beginProviderTransportAttempt(ownsAttempts, attemptOptions);
    const stream = this.wrappedProvider.generateChatCompletion(attemptOptions);
    const producedContent =
      this.config.streamingTimeoutMs > 0
        ? yield* guardStream(stream, {
            timeoutMs: this.config.streamingTimeoutMs,
            attemptController: linked.controller,
            context: request,
          })
        : yield* guardStream(stream, {
            attemptController: linked.controller,
            context: request,
          });
    throwIfEmptyStreamExhaustsBudget(
      producedContent,
      budget.used,
      budget.limit,
    );
    resetRetryErrorCounters(retryState);
    bucketFailoverHandler?.resetSession?.();
  }

  /**
   * Only genuine abort/cancellation is recorded as 'aborted'. Errors after
   * partial stream output (marked by isTerminalRetryError) are transport
   * failures and must remain 'error' so error-vs-cancellation metrics are
   * not corrupted.
   */
  private resolveTerminalStatus(error: unknown): AttemptStatus {
    return isAbortError(error) ? 'aborted' : 'error';
  }

  private finalizeAttempt(
    linked: { controller: AbortController; dispose(): void },
    attemptOptions: GenerateChatOptions,
    budget: TransportAttemptBudget,
    usedBefore: number,
    notification: AttemptNotificationContext,
    terminalStatus: AttemptStatus,
    attemptError: unknown,
    request: RetryRequestContext,
  ): void {
    linked.controller.abort();
    linked.dispose();
    accountProviderAttempt(
      this.wrappedProvider,
      attemptOptions,
      budget,
      usedBefore,
    );
    notification.notifyEnd(
      terminalStatus,
      resolveAttemptErrorMessage(terminalStatus, attemptError),
      this.buildFailureReport(request, terminalStatus, attemptError),
    );
  }

  /**
   * Build the taxonomy/commitment/budget report for attempt telemetry
   * (issue #2532 AC-07). Failure kind/phase decode only applies to failed
   * attempts; commitment and budget are reported for every attempt.
   */
  private buildFailureReport(
    request: RetryRequestContext,
    status: AttemptStatus,
    error: unknown,
  ): AttemptFailureReport {
    const budgetFacts = {
      committed: request.committed,
      exposure: request.exposure,
      budgetUsed: request.budget.used,
      budgetLimit: request.budget.limit,
      totalWaitMs: request.totalWaitMs,
      visitedTargetCount: request.visitedTargets.length,
      visitedCredentialCount: request.visitedCredentialCount,
      deadlineRemainingMs: request.deadlineRemainingMs,
    };
    if (error === undefined) {
      return budgetFacts;
    }
    // Telemetry must never mask the attempt error: a decoding failure
    // degrades the report to budget facts only.
    try {
      const failure = decodeRetryFailure(error);
      return {
        kind: failure.kind,
        phase: failure.phase,
        ...budgetFacts,
      };
    } catch (decodeError) {
      this.logger.debug(
        () => `Failure decode for telemetry threw: ${String(decodeError)}`,
      );
      return budgetFacts;
    }
  }

  private createAttemptNotification(
    observer: AttemptLifecycleObserver | undefined,
    attemptIndex: number,
    modelName: string,
  ): AttemptNotificationContext {
    return new AttemptNotificationContext(
      observer,
      observer !== undefined,
      attemptIndex,
      randomUUID(),
      modelName,
      performance.now(),
      this.name,
      this.logger,
    );
  }

  /**
   * Classifies the error, updates consecutive counters, runs auth/failover
   * handlers, and returns either a throw action or continue action.
   */
  private observeProviderError(
    options: GenerateChatOptions,
    error: unknown,
    status: number | undefined,
    category: StructuredErrorCategory | undefined,
  ): void {
    if (!claimProviderErrorObservation(options, error)) return;
    invokeProviderErrorObserver(
      options.onProviderError,
      toObservedProviderError(error, status, category),
      (observerError) => {
        this.logger.debug(
          () => `Provider error observer failed: ${String(observerError)}`,
        );
      },
    );
  }

  /**
   * Post-exposure failures are terminal: the guarded stream commits before
   * every outward yield, and its post-yield errors also carry the WeakSet
   * terminal mark. A committed request may still repair auth for FUTURE
   * requests (one-shot, no replay), then the error surfaces.
   */
  private async resolveCommittedFailureAction(
    error: unknown,
    request: RetryRequestContext,
  ): Promise<
    { type: 'throw'; error: unknown } | { type: 'continue' } | undefined
  > {
    const failure =
      isTerminalRetryError(error) || getRequestCommitState(request).committed
        ? decodeRetryFailure(error)
        : undefined;
    if (failure === undefined) return undefined;
    return decideCommittedFailure(
      error,
      request,
      failure,
      (authError, authOptions, errorStatus, authSignal) =>
        // The gate swallows repair failures by design (the committed
        // error surfaces either way); log them so the silent catch is
        // observable in debug output.
        this.invokeAuthErrorHandler(
          authError,
          authOptions,
          errorStatus,
          authSignal,
        ).catch((repairError: unknown) => {
          this.logger.debug(
            () => `Post-commitment auth repair failed: ${String(repairError)}`,
          );
          throw repairError;
        }),
    );
  }

  private async handleRetryError(
    error: unknown,
    request: RetryRequestContext,
    options: GenerateChatOptions,
    signal: AbortSignal | undefined,
    state: {
      attempt: number;
      currentDelay: number;
      consecutive429s: number;
      consecutiveAuthErrors: number;
      consecutiveNetworkErrors: number;
      consecutiveServerErrors: number;
    },
    maxAttempts: number,
    initialDelayMs: number,
    failoverThreshold: number,
    bucketFailoverHandler: BucketFailoverHandler | undefined,
    authRetryTimeoutMs: number,
    budget: { used: number; limit: number },
  ): Promise<{ type: 'throw'; error: unknown } | { type: 'continue' }> {
    state.attempt = budget.used;
    const committedFailure = await this.resolveCommittedFailureAction(
      error,
      request,
    );
    if (committedFailure !== undefined) return committedFailure;

    const classification = classifyRetryError(error);
    const { status: errorStatus, category, ...f } = classification;
    this.observeProviderError(options, error, errorStatus, category);
    this.logger.debug(
      () =>
        `[attempt ${state.attempt}/${maxAttempts}] Error: status=${errorStatus}, is429=${f.is429}, is402=${f.is402}, isAuth=${f.isAuthError}, isNetwork=${f.isNetworkError}, is5xx=${f.is5xxServerError}`,
    );
    updateRetryErrorCounters(state, classification);

    const shouldAttemptRefreshRetry = await this.maybeRefreshAuth(
      f.isAuthError,
      state.consecutiveAuthErrors,
      state.attempt,
      maxAttempts,
      error,
      options,
      errorStatus,
      signal,
    );

    const shouldAttemptFailover = shouldFailoverNow(
      state,
      maxAttempts,
      error,
      bucketFailoverHandler,
      failoverThreshold,
    );

    if (shouldAttemptFailover && bucketFailoverHandler) {
      return this.handleFailoverDecision(
        errorStatus,
        f.is429,
        f.isNetworkError,
        f.is5xxServerError,
        state,
        initialDelayMs,
        bucketFailoverHandler,
        error,
        authRetryTimeoutMs,
        signal,
        request,
      );
    }

    return this.decideRetryOrThrow(
      error,
      state,
      maxAttempts,
      initialDelayMs,
      shouldAttemptRefreshRetry,
      signal,
      category,
      errorStatus,
      request,
    );
  }

  private async handleFailoverDecision(
    errorStatus: number | undefined,
    is429: boolean,
    isNetworkError: boolean,
    is5xxServerError: boolean,
    state: {
      consecutive429s: number;
      consecutiveNetworkErrors: number;
      consecutiveAuthErrors: number;
      consecutiveServerErrors: number;
      attempt: number;
      currentDelay: number;
    },
    initialDelayMs: number,
    bucketFailoverHandler: BucketFailoverHandler,
    error: unknown,
    authRetryTimeoutMs: number,
    signal: AbortSignal | undefined,
    request: RetryRequestContext,
  ): Promise<{ type: 'throw'; error: unknown } | { type: 'continue' }> {
    const failoverResult = await attemptBucketFailover(
      errorStatus,
      is429,
      isNetworkError,
      is5xxServerError,
      state,
      bucketFailoverHandler,
      authRetryTimeoutMs,
      signal,
      this.logger,
    );
    if (failoverResult === 'continue') {
      const ms = getDelayDuration(error, state.currentDelay);
      await delay(ms, signal);
      request.recordWait(ms);
      this.config.trackThrottleWaitTime(ms);
      return { type: 'continue' };
    }
    return {
      type: 'throw',
      error: this.createAllBucketsExhaustedError(
        bucketFailoverHandler,
        error as Error,
      ),
    };
  }

  private async decideRetryOrThrow(
    error: unknown,
    state: {
      attempt: number;
      currentDelay: number;
    },
    maxAttempts: number,
    initialDelayMs: number,
    shouldAttemptRefreshRetry: boolean,
    signal: AbortSignal | undefined,
    category: StructuredErrorCategory | undefined,
    status: number | undefined,
    request: RetryRequestContext,
  ): Promise<{ type: 'throw'; error: unknown } | { type: 'continue' }> {
    const shouldRetry = shouldRetryError(error);
    if (!shouldRetry && !shouldAttemptRefreshRetry) {
      return { type: 'throw', error };
    }
    if (state.attempt >= maxAttempts) {
      return {
        type: 'throw',
        error: createRetriesExhaustedError(
          error,
          state.attempt,
          category,
          status,
        ),
      };
    }

    const delayMs = getDelayDuration(error, state.currentDelay);
    this.logger.debug(
      () =>
        `Retrying after ${delayMs}ms (attempt ${state.attempt}/${maxAttempts})`,
    );

    await delay(delayMs, signal);
    request.recordWait(delayMs);
    this.config.trackThrottleWaitTime(delayMs);

    if (hasRetryAfterHeader(error)) {
      state.currentDelay = initialDelayMs;
    } else {
      state.currentDelay = Math.min(
        this.config.maxDelayMs,
        state.currentDelay * 2,
      );
    }

    return { type: 'continue' };
  }

  /**
   * Invoke the auth error handler on the first consecutive auth failure (if
   * retries remain), returning whether a refresh attempt was made. Only grant
   * the retry when a recovery mechanism that can change the outcome is
   * configured (an onAuthError or bucket-failover handler) — otherwise it only
   * burns an attempt + backoff on a terminal 403 (issue #2917).
   */
  private async maybeRefreshAuth(
    isAuthError: boolean,
    consecutiveAuthErrors: number,
    attempt: number,
    maxAttempts: number,
    error: unknown,
    options: GenerateChatOptions,
    errorStatus: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    if (!(isAuthError && consecutiveAuthErrors === 1 && attempt < maxAttempts))
      return false;
    if (!hasAuthRecoveryHandler(options)) return false;
    await this.invokeAuthErrorHandler(error, options, errorStatus, signal);
    return true;
  }

  /**
   * Invoke the auth error handler to allow cache invalidation and force-refresh.
   */
  private async invokeAuthErrorHandler(
    error: unknown,
    options: GenerateChatOptions,
    errorStatus: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const authErrorHandler = getOnAuthErrorHandlerFromOptions(options);
    if (authErrorHandler) {
      try {
        const failedAccessToken = await raceWithAbort(
          resolveAuthTokenFromOptions(options),
          signal,
        );
        const providerId = this.name;
        await raceWithAbort(
          authErrorHandler.handleAuthError({
            failedAccessToken,
            providerId,
            errorStatus: errorStatus ?? 401,
            signal,
          }),
          signal,
        );
      } catch (handlerError) {
        if (signal?.aborted === true) throw handlerError;
        this.logger.debug(
          () =>
            `Auth error handler failed, continuing with retry: ${handlerError}`,
        );
      }
    }
  }

  /**
   * Creates an AllBucketsExhaustedError with failure reasons
   * @plan PLAN-20260223-ISSUE1598.P16
   * @requirement REQ-1598-IC09
   */
  private createAllBucketsExhaustedError(
    handler: BucketFailoverHandler,
    lastError: Error,
  ): AllBucketsExhaustedError {
    const buckets = handler.getBuckets();

    // Get failure reasons if available
    const reasons = handler.getLastFailoverReasons?.() ?? {};

    return new AllBucketsExhaustedError(this.name, buckets, lastError, reasons);
  }
}
function resolveAttemptErrorMessage(
  status: AttemptStatus,
  error: unknown,
): string | undefined {
  if (status === 'success' || error === undefined) return undefined;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Returns true only for genuine abort/cancellation errors. Partial-output
 * transport failures (marked by isTerminalRetryError) are NOT aborts.
 */
function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    (error as NodeJS.ErrnoException).code === 'ABORT_ERR'
  );
}
