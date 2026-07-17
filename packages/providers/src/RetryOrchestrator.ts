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
import type { IModel } from './IModel.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  BucketFailoverHandler,
  FailoverContext,
} from '@vybestack/llxprt-code-core/config/config.js';
import { AllBucketsExhaustedError, permitsBucketFailover } from './errors.js';
import type { StructuredErrorCategory } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  delay,
  createAbortError,
} from '@vybestack/llxprt-code-core/utils/delay.js';
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
  type RetryRequestContext,
} from './retryRequestContext.js';
import {
  accountProviderAttempt,
  beginProviderTransportAttempt,
  createInitialRetryState,
  providerOwnsTransportAttempts,
} from './retryTransportOwnership.js';
import { safeGetDefaultModel } from './utils/safeDefaultModel.js';
import { closeIteratorBeforeContinuing } from './utils/streamCleanup.js';
import {
  classifyRetryError,
  isTerminalRetryError,
  markErrorAfterStreamOutput,
  resetRetryErrorCounters,
  updateRetryErrorCounters,
} from './retryErrorClassification.js';
import {
  createRetriesExhaustedError,
  throwIfEmptyStreamExhaustsBudget,
} from './retryExhaustion.js';
import {
  shouldRetryError,
  getDelayDuration,
  hasRetryAfterHeader,
  resolveFailoverReason,
} from './retryDelayPolicy.js';
import { getAttemptLifecycleObserver } from './logging/attemptLifecycle.js';
import type {
  AttemptLifecycleObserver,
  AttemptStatus,
} from './logging/attemptLifecycle.js';
import { AttemptNotificationContext } from './retryAttemptNotifier.js';
import {
  getBucketFailoverHandlerFromOptions,
  getOnAuthErrorHandlerFromOptions,
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

  private shouldBypassRetry(options: GenerateChatOptions): boolean {
    return options.metadata?.loadBalancerDelegate === true;
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
    if (this.shouldBypassRetry(options)) {
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
        // Only genuine abort/cancellation is recorded as 'aborted'.
        // Errors after partial stream output (marked by
        // isTerminalRetryError) are transport failures and must remain
        // 'error' so error-vs-cancellation metrics are not corrupted.
        terminalStatus = isAbortError(error) ? 'aborted' : 'error';
      } finally {
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
        );
      }
      if (attemptError === undefined) continue;
      const action = await this.handleRetryError(
        attemptError,
        requestOptions,
        retryState,
        maxAttempts,
        initialDelayMs,
        1,
        bucketFailoverHandler,
        signal,
        authRetryTimeoutMs,
        budget,
      );
      if (action.type === 'throw') throw action.error;
    }

    throw this.createRetriesExhaustedError(lastError, budget);
  }

  private async *executeRawAttempt(
    ownsAttempts: boolean,
    attemptOptions: GenerateChatOptions,
    linked: { controller: AbortController },
    retryState: {
      attempt: number;
      currentDelay: number;
      consecutive429s: number;
      consecutiveAuthErrors: number;
      consecutiveNetworkErrors: number;
    },
    bucketFailoverHandler: BucketFailoverHandler | undefined,
    budget: { used: number; limit: number },
  ): AsyncIterableIterator<IContent> {
    beginProviderTransportAttempt(ownsAttempts, attemptOptions);
    const stream = this.wrappedProvider.generateChatCompletion(attemptOptions);
    const producedContent =
      this.config.streamingTimeoutMs > 0
        ? yield* this.streamWithTimeout(
            stream,
            this.config.streamingTimeoutMs,
            linked.controller,
          )
        : yield* this.yieldStreamUnprotected(stream, linked.controller);
    throwIfEmptyStreamExhaustsBudget(
      producedContent,
      budget.used,
      budget.limit,
    );
    resetRetryErrorCounters(retryState);
    bucketFailoverHandler?.resetSession?.();
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
   * Yield stream chunks without timeout, marking the error if chunks were
   * already yielded so the retry loop knows not to retry.
   */
  private async *yieldStreamUnprotected(
    stream: AsyncIterableIterator<IContent>,
    attemptController: AbortController,
  ): AsyncGenerator<IContent, boolean> {
    let chunksYielded = false;
    let completed = false;
    let failed = false;
    let failure: unknown;
    try {
      for await (const chunk of stream) {
        chunksYielded = true;
        yield chunk;
      }
      completed = true;
      return chunksYielded;
    } catch (streamError) {
      failed = true;
      failure = streamError;
      if (chunksYielded) {
        this.logger.debug(
          () =>
            `Error after yielding chunks - cannot retry (would produce mixed response)`,
        );
        throw markErrorAfterStreamOutput(streamError);
      }
      throw streamError;
    } finally {
      if (!completed) {
        attemptController.abort();
        await closeIteratorBeforeContinuing(stream, failure, failed);
      }
    }
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

  private async handleRetryError(
    error: unknown,
    options: GenerateChatOptions,
    state: {
      attempt: number;
      currentDelay: number;
      consecutive429s: number;
      consecutiveAuthErrors: number;
      consecutiveNetworkErrors: number;
    },
    maxAttempts: number,
    initialDelayMs: number,
    failoverThreshold: number,
    bucketFailoverHandler: BucketFailoverHandler | undefined,
    signal: AbortSignal | undefined,
    authRetryTimeoutMs: number,
    budget: { used: number; limit: number },
  ): Promise<{ type: 'throw'; error: unknown } | { type: 'continue' }> {
    state.attempt = budget.used;
    if (isTerminalRetryError(error)) return { type: 'throw', error };

    const classification = classifyRetryError(error);
    const {
      status: errorStatus,
      category,
      is429,
      is402,
      isAuthError,
      isNetworkError,
    } = classification;
    this.observeProviderError(options, error, errorStatus, category);

    this.logger.debug(
      () =>
        `[attempt ${state.attempt}/${maxAttempts}] Error: status=${errorStatus}, is429=${is429}, is402=${is402}, isAuth=${isAuthError}, isNetwork=${isNetworkError}`,
    );

    updateRetryErrorCounters(state, classification);

    const shouldAttemptRefreshRetry =
      isAuthError &&
      state.consecutiveAuthErrors === 1 &&
      state.attempt < maxAttempts;

    if (shouldAttemptRefreshRetry) {
      await this.invokeAuthErrorHandler(error, options, errorStatus, signal);
    }

    const shouldAttemptFailover =
      state.attempt < maxAttempts &&
      permitsBucketFailover(error) &&
      this.shouldAttemptFailover(
        bucketFailoverHandler,
        is429,
        is402,
        isAuthError,
        isNetworkError,
        state,
        failoverThreshold,
      );

    if (shouldAttemptFailover && bucketFailoverHandler) {
      return this.handleFailoverDecision(
        errorStatus,
        is429,
        isNetworkError,
        state,
        initialDelayMs,
        bucketFailoverHandler,
        error,
        authRetryTimeoutMs,
        signal,
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
    );
  }

  private shouldAttemptFailover(
    bucketFailoverHandler: BucketFailoverHandler | undefined,
    is429: boolean,
    is402: boolean,
    isAuthError: boolean,
    isNetworkError: boolean,
    state: {
      consecutive429s: number;
      consecutiveAuthErrors: number;
      consecutiveNetworkErrors: number;
    },
    failoverThreshold: number,
  ): boolean {
    if (bucketFailoverHandler === undefined) {
      return false;
    }
    if (is429 && state.consecutive429s > failoverThreshold) {
      return true;
    }
    if (is402) {
      return true;
    }
    if (isAuthError && state.consecutiveAuthErrors > 1) {
      return true;
    }
    return isNetworkError && state.consecutiveNetworkErrors > failoverThreshold;
  }

  private async handleFailoverDecision(
    errorStatus: number | undefined,
    is429: boolean,
    isNetworkError: boolean,
    state: {
      consecutive429s: number;
      consecutiveNetworkErrors: number;
      consecutiveAuthErrors: number;
      attempt: number;
      currentDelay: number;
    },
    initialDelayMs: number,
    bucketFailoverHandler: BucketFailoverHandler,
    error: unknown,
    authRetryTimeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<{ type: 'throw'; error: unknown } | { type: 'continue' }> {
    const failoverResult = await this.attemptBucketFailover(
      errorStatus,
      is429,
      isNetworkError,
      state,
      bucketFailoverHandler,
      authRetryTimeoutMs,
      signal,
    );
    if (failoverResult === 'continue') {
      state.currentDelay = initialDelayMs;
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
   * Attempt bucket failover; returns 'continue' if failover succeeded
   * (counters reset, retry immediately), or 'exhausted' if no buckets remain.
   * Any rejection from tryFailover is treated as 'exhausted' to honor the
   * 'continue' | 'exhausted' return contract.
   */
  private async attemptBucketFailover(
    errorStatus: number | undefined,
    is429: boolean,
    isNetworkError: boolean,
    state: {
      attempt: number;
      consecutive429s: number;
      consecutiveNetworkErrors: number;
      consecutiveAuthErrors: number;
    },
    bucketFailoverHandler: BucketFailoverHandler,
    authRetryTimeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<'continue' | 'exhausted'> {
    const failoverReason = resolveFailoverReason(
      is429,
      isNetworkError,
      state.consecutive429s,
      state.consecutiveNetworkErrors,
      errorStatus,
    );
    this.logger.debug(
      () => `Attempting bucket failover after ${failoverReason}`,
    );

    const failoverContext: FailoverContext = {
      triggeringStatus: errorStatus,
      authRetryTimeoutMs,
      signal,
    };

    let failoverResult: boolean;
    try {
      failoverResult = await raceWithAbort(
        bucketFailoverHandler.tryFailover(failoverContext),
        signal,
      );
    } catch (failoverError) {
      if (signal?.aborted === true) throw failoverError;
      this.logger.debug(
        () =>
          `Bucket failover handler rejected, treating as exhausted: ${failoverError}`,
      );
      return 'exhausted';
    }

    if (failoverResult) {
      this.logger.debug(
        () => `Bucket failover successful, resetting retry state`,
      );
      resetRetryErrorCounters(state);
      return 'continue';
    }

    this.logger.debug(
      () => `No more buckets available for failover, stopping retry`,
    );
    return 'exhausted';
  }

  /**
   * Wraps an async generator with a timeout for the first chunk
   */
  private async *streamWithTimeout(
    stream: AsyncIterableIterator<IContent>,
    timeoutMs: number,
    attemptController: AbortController,
  ): AsyncGenerator<IContent, boolean> {
    const iterator = stream[Symbol.asyncIterator]();
    let firstChunk = true;
    let chunksYielded = false;
    let completed = false;
    let failed = false;
    let failure: unknown;

    try {
      for (;;) {
        if (attemptController.signal.aborted) {
          throw createAbortError(attemptController.signal.reason);
        }
        const nextPromise = iterator.next();
        const result = firstChunk
          ? await raceFirstChunkWithTimeout(nextPromise, timeoutMs)
          : await nextPromise;
        firstChunk = false;
        if (result.done === true) {
          completed = true;
          return chunksYielded;
        }
        chunksYielded = true;
        yield result.value;
      }
    } catch (error) {
      failed = true;
      const propagatedFailure = chunksYielded
        ? markErrorAfterStreamOutput(error)
        : error;
      failure = propagatedFailure;
      throw propagatedFailure;
    } finally {
      if (!completed) {
        attemptController.abort();
        await closeIteratorBeforeContinuing(iterator, failure, failed);
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
/**
 * Race the first stream chunk against a timeout. Resolves with the iterator
 * result (clearing the timeout), or rejects with a stream-timeout error.
 */
async function raceFirstChunkWithTimeout<T>(
  nextPromise: Promise<IteratorResult<T>>,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  const timeoutController = new AbortController();
  try {
    const timeoutPromise = delay(timeoutMs, timeoutController.signal).then(
      () => {
        throw new Error(
          `Stream timeout: first chunk not received after ${timeoutMs}ms`,
        );
      },
    );
    return await Promise.race([nextPromise, timeoutPromise]);
  } finally {
    timeoutController.abort();
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
