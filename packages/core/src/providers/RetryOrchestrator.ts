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

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy provider boundary retained while larger decomposition continues. */

import {
  type IProvider,
  type GenerateChatOptions,
  type ProviderToolset,
} from './IProvider.js';
import type { IModel } from './IModel.js';
import type { IContent } from '../services/history/IContent.js';
import type {
  BucketFailoverHandler,
  FailoverContext,
} from '../config/config.js';
import {
  getErrorStatus,
  isNetworkTransientError,
  isOverloadError,
} from '../utils/retry.js';
import { delay, createAbortError } from '../utils/delay.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import { AllBucketsExhaustedError } from './errors.js';
import type { OnAuthErrorHandler } from '../config/configTypes.js';

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
      trackThrottleWaitTime: config?.trackThrottleWaitTime ?? (() => {}),
    };
  }

  /**
   * Check if the wrapped provider is a LoadBalancingProvider
   * LoadBalancingProvider has its own retry/failover logic, so we should
   * pass through without adding retry orchestration
   */
  private isLoadBalancer(): boolean {
    // Check by name pattern rather than importing LoadBalancingProvider
    // to avoid circular dependency
    return this.wrappedProvider.name.includes('-lb-');
  }

  // Delegate all IProvider methods to wrapped provider

  async getModels(): Promise<IModel[]> {
    return this.wrappedProvider.getModels();
  }

  getDefaultModel(): string {
    return this.wrappedProvider.getDefaultModel();
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

  clearAuthCache?(): void {
    this.wrappedProvider.clearAuthCache?.();
  }

  clearAuth?(): void {
    this.wrappedProvider.clearAuth?.();
  }

  /**
   * Main method with retry orchestration logic
   * Supports both overloaded signatures for backward compatibility
   */
  generateChatCompletion(
    optionsOrContents: GenerateChatOptions | IContent[],
    tools?: ProviderToolset,
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent> {
    // Normalize arguments to GenerateChatOptions
    let options: GenerateChatOptions;

    if (Array.isArray(optionsOrContents)) {
      // Legacy signature: (contents, tools?, signal?)
      options = {
        contents: optionsOrContents,
        tools,
        invocation: signal
          ? ({ signal } as unknown as GenerateChatOptions['invocation'])
          : undefined,
      } as GenerateChatOptions;
    } else {
      // Modern signature: (options)
      options = optionsOrContents;

      // Ensure invocation.signal is propagated to options
      if (!options.invocation && signal) {
        options = {
          ...options,
          invocation: {
            signal,
          } as unknown as GenerateChatOptions['invocation'],
        };
      }
    }

    return this.generateChatCompletionWithRetry(options);
  }

  /**
   * Core retry orchestration logic
   */
  private async *generateChatCompletionWithRetry(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    // If the wrapped provider is a LoadBalancingProvider, pass through without retry logic
    // because LoadBalancingProvider already has its own failover and retry mechanisms.
    // Don't buffer chunks for LoadBalancingProvider to avoid timeout issues.
    if (this.isLoadBalancer()) {
      for await (const chunk of this.wrappedProvider.generateChatCompletion(
        options,
      )) {
        yield chunk;
      }
      return;
    }

    // Extract signal - it may be on invocation or in options directly
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
    const signal = (options.invocation as { signal?: AbortSignal })?.signal;

    // Check for abort before starting
    if (isSignalAborted(signal)) {
      throw createAbortError();
    }

    // Read ephemeral settings for retry configuration
    const maxAttempts =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
      (options.invocation?.ephemerals?.['retries'] as number | undefined) ??
      this.config.maxAttempts;
    const initialDelayMs =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
      (options.invocation?.ephemerals?.['retrywait'] as number | undefined) ??
      this.config.initialDelayMs;

    const bucketFailoverHandler = this.getBucketFailoverHandler(options);

    const retryState = {
      attempt: 0,
      currentDelay: initialDelayMs,
      consecutive429s: 0,
      consecutiveAuthErrors: 0,
      consecutiveNetworkErrors: 0,
    };
    const failoverThreshold = 1;

    while (retryState.attempt < maxAttempts) {
      if (isSignalAborted(signal)) {
        throw createAbortError();
      }

      retryState.attempt++;

      try {
        if (isSignalAborted(signal)) {
          throw createAbortError();
        }

        const stream = this.wrappedProvider.generateChatCompletion(options);

        if (this.config.streamingTimeoutMs > 0) {
          yield* this.streamWithTimeout(
            stream,
            this.config.streamingTimeoutMs,
            signal,
          );
        } else {
          yield* this.yieldStreamUnprotected(stream);
        }

        // Success - reset error counters and bucket failover tracking
        retryState.consecutive429s = 0;
        retryState.consecutiveAuthErrors = 0;
        retryState.consecutiveNetworkErrors = 0;
        bucketFailoverHandler?.resetSession?.();
        return;
      } catch (error) {
        const action = await this.handleRetryError(
          error,
          options,
          retryState,
          maxAttempts,
          initialDelayMs,
          failoverThreshold,
          bucketFailoverHandler,
          signal,
        );
        if (action.type === 'throw') {
          throw action.error;
        }
        // action.type === 'continue' — loop again
      }
    }

    // Exhausted all retries
    throw new Error('Retry attempts exhausted');
  }

  /**
   * Yield stream chunks without timeout, marking the error if chunks were
   * already yielded so the retry loop knows not to retry.
   */
  private async *yieldStreamUnprotected(
    stream: AsyncIterableIterator<IContent>,
  ): AsyncGenerator<IContent> {
    let chunksYielded = false;
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    try {
      for await (const chunk of stream) {
        chunksYielded = true;
        yield chunk;
      }
    } catch (streamError) {
      if (chunksYielded) {
        this.logger.debug(
          () =>
            `Error after yielding chunks - cannot retry (would produce mixed response)`,
        );
        (
          streamError as Error & { _chunksYieldedBeforeError: boolean }
        )._chunksYieldedBeforeError = true;
      }
      throw streamError;
    }
  }

  /**
   * Classifies the error, updates consecutive counters, runs auth/failover
   * handlers, and returns either a throw action or continue action.
   */
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
  ): Promise<{ type: 'throw'; error: unknown } | { type: 'continue' }> {
    if (error instanceof Error && error.name === 'AbortError') {
      return { type: 'throw', error };
    }

    if (
      (error as Error & { _chunksYieldedBeforeError?: boolean })
        ._chunksYieldedBeforeError === true
    ) {
      return { type: 'throw', error };
    }

    const errorStatus = getErrorStatus(error);
    const isOverload = isOverloadError(error);
    const is429 = errorStatus === 429 || isOverload;
    const is402 = errorStatus === 402;
    const isAuthError = errorStatus === 401 || errorStatus === 403;
    const isNetworkError = isNetworkTransientError(error);

    this.logger.debug(
      () =>
        `[attempt ${state.attempt}/${maxAttempts}] Error: status=${errorStatus}, is429=${is429}, is402=${is402}, isAuth=${isAuthError}, isNetwork=${isNetworkError}`,
    );

    this.updateConsecutiveCounters(state, is429, isAuthError, isNetworkError);

    const shouldAttemptRefreshRetry =
      isAuthError && state.consecutiveAuthErrors === 1;

    if (shouldAttemptRefreshRetry) {
      await this.invokeAuthErrorHandler(error, options, errorStatus);
    }

    const shouldAttemptFailover =
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      bucketFailoverHandler != null &&
      ((is429 && state.consecutive429s > failoverThreshold) ||
        is402 ||
        (isAuthError && state.consecutiveAuthErrors > 1) ||
        (isNetworkError && state.consecutiveNetworkErrors > failoverThreshold));

    if (shouldAttemptFailover) {
      return this.handleFailoverDecision(
        errorStatus,
        is429,
        isNetworkError,
        state,
        initialDelayMs,
        bucketFailoverHandler,
        error,
      );
    }

    return this.decideRetryOrThrow(
      error,
      state,
      maxAttempts,
      initialDelayMs,
      shouldAttemptRefreshRetry,
      signal,
    );
  }

  private updateConsecutiveCounters(
    state: {
      consecutive429s: number;
      consecutiveAuthErrors: number;
      consecutiveNetworkErrors: number;
    },
    is429: boolean,
    isAuthError: boolean,
    isNetworkError: boolean,
  ): void {
    if (is429) {
      state.consecutive429s++;
    } else {
      state.consecutive429s = 0;
    }
    if (isAuthError) {
      state.consecutiveAuthErrors++;
    } else {
      state.consecutiveAuthErrors = 0;
    }
    if (isNetworkError && !is429 && !isAuthError) {
      state.consecutiveNetworkErrors++;
    } else {
      state.consecutiveNetworkErrors = 0;
    }
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
  ): Promise<{ type: 'throw'; error: unknown } | { type: 'continue' }> {
    const failoverResult = await this.attemptBucketFailover(
      errorStatus,
      is429,
      isNetworkError,
      state,
      bucketFailoverHandler,
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
  ): Promise<{ type: 'throw'; error: unknown } | { type: 'continue' }> {
    const shouldRetry = this.shouldRetryError(error);
    if (!shouldRetry && !shouldAttemptRefreshRetry) {
      return { type: 'throw', error };
    }
    if (state.attempt >= maxAttempts && !shouldAttemptRefreshRetry) {
      return { type: 'throw', error };
    }
    if (state.attempt >= maxAttempts && shouldAttemptRefreshRetry) {
      state.attempt--;
    }

    const delayMs = this.getDelayDuration(error, state.currentDelay);
    this.logger.debug(
      () =>
        `Retrying after ${delayMs}ms (attempt ${state.attempt}/${maxAttempts})`,
    );

    await delay(delayMs, signal);
    this.config.trackThrottleWaitTime(delayMs);

    if (this.hasRetryAfterHeader(error)) {
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
  ): Promise<void> {
    const authErrorHandler = this.getOnAuthErrorHandler(options);
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (authErrorHandler) {
      try {
        const failedAccessToken = await this.resolveAuthToken(options);
        const providerId = this.name;
        await authErrorHandler.handleAuthError({
          failedAccessToken,
          providerId,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
          errorStatus: errorStatus ?? 401,
        });
      } catch (handlerError) {
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
  ): Promise<'continue' | 'exhausted'> {
    const failoverReason = is429
      ? `${state.consecutive429s} consecutive 429 errors`
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        isNetworkError
        ? `${state.consecutiveNetworkErrors} consecutive network errors`
        : `status ${errorStatus}`;
    this.logger.debug(
      () => `Attempting bucket failover after ${failoverReason}`,
    );

    const failoverContext: FailoverContext = {
      triggeringStatus: errorStatus,
    };

    const failoverResult =
      await bucketFailoverHandler.tryFailover(failoverContext);

    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (failoverResult) {
      this.logger.debug(
        () => `Bucket failover successful, resetting retry state`,
      );
      state.consecutive429s = 0;
      state.consecutiveAuthErrors = 0;
      state.consecutiveNetworkErrors = 0;
      state.attempt--;
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
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent> {
    const iterator = stream[Symbol.asyncIterator]();
    let firstChunk = true;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
    while (true) {
      if (isSignalAborted(signal)) {
        throw createAbortError();
      }

      const nextPromise = iterator.next();

      // Apply timeout only for first chunk
      if (firstChunk && timeoutMs > 0) {
        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Stream timeout: first chunk not received')),
            timeoutMs,
          );
        });

        try {
          const result = await Promise.race([nextPromise, timeoutPromise]);

          // Clear the timeout now that we got the first chunk
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }

          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (result.done === true) {
            return;
          }

          firstChunk = false;
          yield result.value;
        } catch (error) {
          // Clear timeout on error
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
          throw error;
        }
      } else {
        const result = await nextPromise;

        if (result.done === true) {
          return;
        }

        yield result.value;
      }
    }
  }

  /**
   * Determines if an error should trigger a retry
   */
  private shouldRetryError(error: unknown): boolean {
    const status = getErrorStatus(error);

    // Don't retry client errors (4xx except 429)
    if (status === 400 || status === 404) {
      return false;
    }

    // Retry rate limits (429)
    if (status === 429 || isOverloadError(error)) {
      return true;
    }

    // Retry server errors (5xx)
    if (status !== undefined && status >= 500 && status < 600) {
      return true;
    }

    // Retry network transient errors
    if (isNetworkTransientError(error)) {
      return true;
    }

    // Retry auth errors (allow one retry for token refresh)
    if (status === 401 || status === 403) {
      return true;
    }

    // Retry stream timeouts
    if (error instanceof Error && error.message.includes('Stream timeout')) {
      return true;
    }

    return false;
  }

  /**
   * Gets the delay duration for a retry, respecting Retry-After header
   */
  private getDelayDuration(error: unknown, defaultDelay: number): number {
    const retryAfterMs = this.getRetryAfterDelayMs(error);

    if (retryAfterMs > 0) {
      return retryAfterMs;
    }

    // Apply jitter to default delay: +/- 30%
    const jitter = defaultDelay * 0.3 * (Math.random() * 2 - 1);
    return Math.max(0, defaultDelay + jitter);
  }

  /**
   * Extracts Retry-After delay from error headers
   */
  private getRetryAfterDelayMs(error: unknown): number {
    if (typeof error === 'object' && error !== null) {
      const errorObj = error as {
        response?: { headers?: { 'retry-after'?: unknown } };
      };

      const retryAfter = errorObj.response?.headers?.['retry-after'];
      if (typeof retryAfter === 'string' && retryAfter !== '') {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) {
          return seconds * 1000;
        }

        // Try parsing as HTTP date
        const date = new Date(retryAfter);
        if (!isNaN(date.getTime())) {
          return Math.max(0, date.getTime() - Date.now());
        }
      }
    }

    return 0;
  }

  /**
   * Checks if error has a Retry-After header
   */
  private hasRetryAfterHeader(error: unknown): boolean {
    return this.getRetryAfterDelayMs(error) > 0;
  }

  /**
   * Gets the bucket failover handler from options
   */
  private getBucketFailoverHandler(
    options: GenerateChatOptions,
  ): BucketFailoverHandler | undefined {
    return (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
      options.runtime?.config?.getBucketFailoverHandler?.() ??
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
      options.config?.getBucketFailoverHandler?.()
    );
  }

  /**
   * Gets the auth error handler from options
   * @fix issue1861
   */
  private getOnAuthErrorHandler(
    options: GenerateChatOptions,
  ): OnAuthErrorHandler | undefined {
    return (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
      options.runtime?.config?.getOnAuthErrorHandler?.() ??
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider retry runtime state.
      options.config?.getOnAuthErrorHandler?.()
    );
  }

  /**
   * Resolves the auth token from options (handles both string and RuntimeAuthTokenProvider)
   * @fix issue1861
   */
  private async resolveAuthToken(
    options: GenerateChatOptions,
  ): Promise<string> {
    const authToken = options.resolved?.authToken;
    if (typeof authToken === 'string') {
      return authToken;
    }
    // Handle plain function returning string or Promise<string>
    // Note: tests may bypass type system, so we need runtime check
    if (
      typeof authToken === 'function' &&
      !('provide' in (authToken as unknown as object))
    ) {
      const result = await (authToken as () => string | Promise<string>)();
      return typeof result === 'string' ? result : '';
    }
    // Handle RuntimeAuthTokenProvider object with provide method
    if (
      authToken &&
      typeof authToken === 'object' &&
      'provide' in authToken &&
      typeof (authToken as { provide?: unknown }).provide === 'function'
    ) {
      const result = await (
        authToken as {
          provide: () => Promise<string | undefined> | string | undefined;
        }
      ).provide();
      return typeof result === 'string' ? result : '';
    }
    return '';
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
