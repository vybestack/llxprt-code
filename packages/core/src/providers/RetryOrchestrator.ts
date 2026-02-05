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
import type { IContent } from '../services/history/IContent.js';
import type { BucketFailoverHandler } from '../config/config.js';
import {
  getErrorStatus,
  isNetworkTransientError,
  isOverloadError,
} from '../utils/retry.js';
import { delay, createAbortError } from '../utils/delay.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import { AllBucketsExhaustedError } from './errors.js';

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
    const signal = (options.invocation as { signal?: AbortSignal })?.signal;

    // Check for abort before starting
    if (signal?.aborted) {
      throw createAbortError();
    }

    // Read ephemeral settings for retry configuration
    const maxAttempts =
      (options.invocation?.ephemerals?.['retries'] as number | undefined) ??
      this.config.maxAttempts;
    const initialDelayMs =
      (options.invocation?.ephemerals?.['retrywait'] as number | undefined) ??
      this.config.initialDelayMs;

    const bucketFailoverHandler = this.getBucketFailoverHandler(options);

    let attempt = 0;
    let currentDelay = initialDelayMs;
    let consecutive429s = 0;
    let consecutiveAuthErrors = 0;
    const failoverThreshold = 1; // Attempt bucket failover after this many consecutive 429s

    while (attempt < maxAttempts) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      attempt++;

      try {
        // Check abort signal before calling provider
        if (signal?.aborted) {
          throw createAbortError();
        }

        // Apply streaming timeout if configured
        const stream = this.wrappedProvider.generateChatCompletion(options);

        if (this.config.streamingTimeoutMs > 0) {
          // Wrap stream with timeout for first chunk
          yield* this.streamWithTimeout(
            stream,
            this.config.streamingTimeoutMs,
            signal,
          );
        } else {
          // No timeout - yield chunks as they arrive (true streaming)
          // Let retry logic handle mid-stream errors
          for await (const chunk of stream) {
            yield chunk;
          }
        }

        // Success - reset error counters and return
        consecutive429s = 0;
        consecutiveAuthErrors = 0;
        return;
      } catch (error) {
        // Check for abort
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }

        const errorStatus = getErrorStatus(error);
        const isOverload = isOverloadError(error);
        const is429 = errorStatus === 429 || isOverload;
        const is402 = errorStatus === 402;
        const isAuthError = errorStatus === 401 || errorStatus === 403;

        this.logger.debug(
          () =>
            `[attempt ${attempt}/${maxAttempts}] Error: status=${errorStatus}, is429=${is429}, is402=${is402}, isAuth=${isAuthError}`,
        );

        // Track consecutive errors for bucket failover
        if (is429) {
          consecutive429s++;
        } else {
          consecutive429s = 0;
        }

        if (isAuthError) {
          consecutiveAuthErrors++;
        } else {
          consecutiveAuthErrors = 0;
        }

        // Retry once to allow OAuth refresh before failover
        const shouldAttemptRefreshRetry =
          isAuthError && bucketFailoverHandler && consecutiveAuthErrors === 1;

        // Determine if we should attempt bucket failover
        const shouldAttemptFailover =
          bucketFailoverHandler &&
          ((is429 && consecutive429s > failoverThreshold) ||
            is402 ||
            (isAuthError && consecutiveAuthErrors > 1));

        if (shouldAttemptFailover) {
          const failoverReason = is429
            ? `${consecutive429s} consecutive 429 errors`
            : `status ${errorStatus}`;
          this.logger.debug(
            () => `Attempting bucket failover after ${failoverReason}`,
          );

          const failoverResult = await bucketFailoverHandler.tryFailover();

          if (failoverResult) {
            // Bucket switch succeeded - reset counters and retry immediately
            this.logger.debug(
              () => `Bucket failover successful, resetting retry state`,
            );
            consecutive429s = 0;
            consecutiveAuthErrors = 0;
            currentDelay = initialDelayMs;
            // Don't increment attempt counter - fresh start with new bucket
            attempt--;
            continue;
          } else {
            // No more buckets available
            this.logger.debug(
              () => `No more buckets available for failover, stopping retry`,
            );
            throw this.createAllBucketsExhaustedError(
              bucketFailoverHandler,
              error as Error,
            );
          }
        }

        // Check if error is retryable
        const shouldRetry = this.shouldRetryError(error);

        if (!shouldRetry && !shouldAttemptRefreshRetry) {
          throw error;
        }

        if (attempt >= maxAttempts && !shouldAttemptRefreshRetry) {
          throw error;
        }

        // Allow one extra retry for auth refresh
        if (attempt >= maxAttempts && shouldAttemptRefreshRetry) {
          attempt--;
        }

        // Apply backoff delay
        const delayMs = this.getDelayDuration(error, currentDelay);

        this.logger.debug(
          () =>
            `Retrying after ${delayMs}ms (attempt ${attempt}/${maxAttempts})`,
        );

        await delay(delayMs, signal);

        // Track throttle wait time
        this.config.trackThrottleWaitTime(delayMs);

        // Update delay for next retry
        if (this.hasRetryAfterHeader(error)) {
          // Reset to initial delay after respecting Retry-After
          currentDelay = initialDelayMs;
        } else {
          // Exponential backoff
          currentDelay = Math.min(this.config.maxDelayMs, currentDelay * 2);
        }
      }
    }

    // Exhausted all retries
    throw new Error('Retry attempts exhausted');
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

    while (true) {
      if (signal?.aborted) {
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
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }

          if (result.done) {
            return;
          }

          firstChunk = false;
          yield result.value;
        } catch (error) {
          // Clear timeout on error
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
          throw error;
        }
      } else {
        const result = await nextPromise;

        if (result.done) {
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
    if (status && status >= 500 && status < 600) {
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

      if (errorObj.response?.headers?.['retry-after']) {
        const retryAfter = errorObj.response.headers['retry-after'];

        if (typeof retryAfter === 'string') {
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
    return options.runtime?.config?.getBucketFailoverHandler?.();
  }

  /**
   * Creates an AllBucketsExhaustedError
   */
  private createAllBucketsExhaustedError(
    handler: BucketFailoverHandler,
    lastError: Error,
  ): AllBucketsExhaustedError {
    const buckets = handler.getBuckets();
    return new AllBucketsExhaustedError(this.name, buckets, lastError);
  }
}
