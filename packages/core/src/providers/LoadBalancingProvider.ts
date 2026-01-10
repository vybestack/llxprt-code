/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251211issue486b
 * Phase 1: LoadBalancingProvider Skeleton Implementation
 *
 * This provider wraps multiple sub-profile configurations and delegates
 * requests to the appropriate provider based on a round-robin strategy.
 * Selection happens at REQUEST TIME, not profile load time.
 */

import {
  IProvider,
  GenerateChatOptions,
  ProviderToolset,
} from './IProvider.js';
import { IModel } from './IModel.js';
import { IContent } from '../services/history/IContent.js';
import { ProviderManager } from './ProviderManager.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import type { Profile } from '../types/modelParams.js';
import { LoadBalancerFailoverError } from './errors.js';
import { isNetworkTransientError, getErrorStatus } from '../utils/retry.js';

/**
 * Sub-profile configuration for load balancing
 */
export interface LoadBalancerSubProfile {
  name: string;
  providerName: string;
  modelId?: string;
  baseURL?: string;
  authToken?: string;
}

/**
 * Load balancing provider configuration
 * @plan PLAN-20251211issue486c - Updated to support ResolvedSubProfile
 * @plan PLAN-20251212issue488 - Added failover strategy
 */
export interface LoadBalancingProviderConfig {
  profileName: string;
  strategy: 'round-robin' | 'failover';
  subProfiles: ResolvedSubProfile[] | LoadBalancerSubProfile[];
  lbProfileEphemeralSettings?: Record<string, unknown>;
}

/**
 * Backend performance metrics
 * @plan PLAN-20251212issue489 - Phase 1
 */
export interface BackendMetrics {
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  tokens: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

/**
 * Circuit breaker state for a backend
 * @plan PLAN-20251212issue489 - Phase 1
 */
export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: Array<{ timestamp: number; error: Error }>;
  openedAt?: number;
  lastAttempt?: number;
}

/**
 * Load balancer statistics interface
 */
export interface LoadBalancerStats {
  profileName: string;
  totalRequests: number;
  lastSelected: string | null;
  profileCounts: Record<string, number>;
}

/**
 * Extended load balancer statistics with metrics
 * @plan PLAN-20251212issue489 - Phase 1
 */
export interface ExtendedLoadBalancerStats extends LoadBalancerStats {
  backendMetrics: Record<string, BackendMetrics>;
  circuitBreakerStates: Record<string, CircuitBreakerState>;
  currentTPM: Record<string, number>;
}

/**
 * Resolved sub-profile with all settings needed for provider instantiation
 * @plan PLAN-20251211issue486c
 */
export interface ResolvedSubProfile {
  name: string;
  providerName: string;
  model: string;
  baseURL?: string;
  authToken?: string;
  authKeyfile?: string;
  ephemeralSettings: Record<string, unknown>;
  modelParams: Record<string, unknown>;
}

/**
 * Type guard to identify load balancer profile format
 * @plan PLAN-20251211issue486c
 */
export function isLoadBalancerProfileFormat(profile: Profile): boolean {
  return (
    'type' in profile &&
    profile.type === 'loadbalancer' &&
    'profiles' in profile &&
    Array.isArray(profile.profiles) &&
    profile.profiles.every((p) => typeof p === 'string')
  );
}

/**
 * Type guard to identify ResolvedSubProfile
 * @plan PLAN-20251211issue486c
 */
export function isResolvedSubProfile(
  profile: ResolvedSubProfile | LoadBalancerSubProfile,
): profile is ResolvedSubProfile {
  return (
    'model' in profile &&
    'ephemeralSettings' in profile &&
    'modelParams' in profile
  );
}

/**
 * Failover settings extracted from ephemeral settings
 * @plan PLAN-20251212issue488
 * @plan PLAN-20251212issue489 - Phase 1: Extended with advanced settings
 */
interface FailoverSettings {
  retryCount: number;
  retryDelayMs: number;
  failoverOnNetworkErrors: boolean;
  failoverStatusCodes: number[] | undefined;
  // Advanced failover settings (Phase 3, Issue #489)
  tpmThreshold: number | undefined;
  timeoutMs: number | undefined;
  circuitBreakerEnabled: boolean;
  circuitBreakerFailureThreshold: number;
  circuitBreakerFailureWindowMs: number;
  circuitBreakerRecoveryTimeoutMs: number;
}

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
  // Circuit breaker state tracking (Phase 2, Issue #489)
  private circuitBreakerStates: Map<string, CircuitBreakerState> = new Map();
  // TPM buckets: Map<minuteBucket, Map<profileName, tokenCount>> (Phase 4, Issue #489)
  private tpmBuckets: Map<number, Map<string, number>> = new Map();
  // Backend metrics tracking (Phase 5, Issue #489)
  private backendMetrics: Map<string, BackendMetrics> = new Map();

  constructor(
    private readonly config: LoadBalancingProviderConfig,
    private readonly providerManager: ProviderManager,
  ) {
    // Validate required dependencies
    if (!providerManager) {
      throw new Error(
        'LoadBalancingProvider requires a ProviderManager dependency',
      );
    }

    // Validate configuration
    this.validateConfig(config);
  }

  /**
   * Validate the load balancing configuration
   * @plan PLAN-20251211issue486c - Updated to handle ResolvedSubProfile
   */
  private validateConfig(config: LoadBalancingProviderConfig): void {
    // Check for empty subProfiles array
    if (!config.subProfiles || config.subProfiles.length === 0) {
      throw new Error(
        'LoadBalancingProvider requires at least one sub-profile in configuration',
      );
    }

    // Check for valid strategy
    if (config.strategy !== 'round-robin' && config.strategy !== 'failover') {
      throw new Error(
        `Invalid strategy "${config.strategy}". Supported: "round-robin", "failover".`,
      );
    }

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

        if (
          !subProfile.ephemeralSettings ||
          typeof subProfile.ephemeralSettings !== 'object'
        ) {
          throw new Error(
            `ResolvedSubProfile "${subProfile.name}" must have a valid "ephemeralSettings" field (object)`,
          );
        }

        if (
          !subProfile.modelParams ||
          typeof subProfile.modelParams !== 'object'
        ) {
          throw new Error(
            `ResolvedSubProfile "${subProfile.name}" must have a valid "modelParams" field (object)`,
          );
        }
      }
    }
  }

  /**
   * Select the next sub-profile using round-robin strategy
   * Returns the sub-profile at the current index, then increments and wraps around
   * @plan PLAN-20251211issue486c - Updated to return union type
   */
  selectNextSubProfile(): ResolvedSubProfile | LoadBalancerSubProfile {
    const subProfile = this.config.subProfiles[this.roundRobinIndex];
    this.roundRobinIndex =
      (this.roundRobinIndex + 1) % this.config.subProfiles.length;
    return subProfile;
  }

  /**
   * Get available models (stub for Phase 1)
   * Will be implemented in later phases to aggregate models from all sub-profiles
   */
  async getModels(): Promise<IModel[]> {
    // Stub implementation - returns empty array
    // Later phases will use: this.config.subProfiles and this.providerManager
    void this.config;
    void this.providerManager;
    return [];
  }

  /**
   * Generate chat completion by delegating to selected sub-profile provider
   * Phase 3c: Request Delegation with Settings Merge Implementation
   * @plan PLAN-20251211issue486c
   */
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
      // Called with content array (legacy signature)
      options = {
        contents: optionsOrContent,
        tools,
      };
    } else {
      // Called with GenerateChatOptions
      options = optionsOrContent;
    }

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

    // Phase 5: Track stats for selected sub-profile
    this.incrementStats(subProfile.name);

    // Record request start for backend metrics (Issue #489)
    const startTime = this.recordRequestStart(subProfile.name);

    // Phase 3 Step 2: Get delegate provider from ProviderManager
    const delegateProvider = this.providerManager.getProviderByName(
      subProfile.providerName,
    );

    // Phase 3 Step 3: Throw descriptive error if provider not found
    if (!delegateProvider) {
      const errorMsg = `Provider "${subProfile.providerName}" not found for sub-profile "${subProfile.name}"`;
      this.logger.error(() => errorMsg);
      throw new Error(errorMsg);
    }

    this.logger.debug(
      () =>
        `Delegating to provider: ${delegateProvider.name} (sub-profile: ${subProfile.name})`,
    );

    // Phase 3c: Build options.resolved with proper settings merge
    let resolvedOptions: GenerateChatOptions;

    if (isResolvedSubProfile(subProfile)) {
      // Phase 3c: Handle ResolvedSubProfile with dumb merge for ephemeralSettings
      // LB profile ephemeralSettings override sub-profile ephemeralSettings
      const mergedEphemeralSettings = {
        ...subProfile.ephemeralSettings,
        ...this.config.lbProfileEphemeralSettings,
      };

      // Extract individual ephemeralSettings that map to resolved fields
      const temperature = mergedEphemeralSettings.temperature as
        | number
        | undefined;
      const maxTokens = mergedEphemeralSettings.maxTokens as number | undefined;
      const streaming = mergedEphemeralSettings.streaming as
        | boolean
        | undefined;

      resolvedOptions = {
        ...options,
        resolved: {
          // Start with existing resolved settings if any
          ...options.resolved,
          // Provider, model, baseURL, authToken ALWAYS come from sub-profile
          model: subProfile.model,
          ...(subProfile.baseURL && { baseURL: subProfile.baseURL }),
          ...(subProfile.authToken && { authToken: subProfile.authToken }),
          // Map ephemeralSettings to resolved fields
          ...(temperature !== undefined && { temperature }),
          ...(maxTokens !== undefined && { maxTokens }),
          ...(streaming !== undefined && { streaming }),
        },
        // Store merged ephemeralSettings and modelParams in metadata for provider use
        metadata: {
          ...options.metadata,
          ephemeralSettings: mergedEphemeralSettings,
          modelParams: subProfile.modelParams,
        },
      };

      this.logger.debug(
        () =>
          `Resolved settings (ResolvedSubProfile) - model: ${resolvedOptions.resolved?.model}, ` +
          `baseURL: ${resolvedOptions.resolved?.baseURL}, ` +
          `authToken: ${resolvedOptions.resolved?.authToken ? 'present' : 'missing'}, ` +
          `temperature: ${temperature}, maxTokens: ${maxTokens}, ` +
          `ephemeralSettings keys: ${Object.keys(mergedEphemeralSettings).join(', ')}, ` +
          `modelParams keys: ${Object.keys(subProfile.modelParams).join(', ')}`,
      );
    } else {
      // Phase 3: Handle LoadBalancerSubProfile (legacy path)
      // Sub-profile settings override any existing resolved settings
      resolvedOptions = {
        ...options,
        resolved: {
          // Start with existing resolved settings if any
          ...options.resolved,
          // Override with sub-profile settings (only if defined)
          ...(subProfile.modelId && { model: subProfile.modelId }),
          ...(subProfile.baseURL && { baseURL: subProfile.baseURL }),
          ...(subProfile.authToken && { authToken: subProfile.authToken }),
        },
      };

      this.logger.debug(
        () =>
          `Resolved settings (LoadBalancerSubProfile) - model: ${resolvedOptions.resolved?.model}, ` +
          `baseURL: ${resolvedOptions.resolved?.baseURL}, ` +
          `authToken: ${resolvedOptions.resolved?.authToken ? 'present' : 'missing'}`,
      );
    }

    // Phase 3 Step 5: Delegate to provider.generateChatCompletion() and yield all chunks
    // Wrap to track backend metrics (Issue #489)
    try {
      const chunks: IContent[] = [];
      for await (const chunk of delegateProvider.generateChatCompletion(
        resolvedOptions,
      )) {
        chunks.push(chunk);
        yield chunk;
      }
      // Extract tokens and record success
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
   * Get default model (stub for Phase 1)
   * Will be implemented in later phases to return first sub-profile's model
   */
  getDefaultModel(): string {
    // Stub implementation - returns empty string
    // Later phases will return the first sub-profile's model or a sensible default
    return '';
  }

  /**
   * Get server tools (stub for Phase 1)
   * Will be implemented in later phases to aggregate tools from delegate providers
   */
  getServerTools(): string[] {
    // Stub implementation - returns empty array
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
    this.stats.set(subProfileName, (this.stats.get(subProfileName) || 0) + 1);
    this.lastSelected = subProfileName;
    this.totalRequests++;
  }

  /**
   * Get load balancer statistics
   * Phase 5: Stats Integration
   * @plan PLAN-20251212issue489 - Phase 2: Updated to return ExtendedLoadBalancerStats
   */
  getStats(): ExtendedLoadBalancerStats {
    const profileCounts: Record<string, number> = {};
    for (const [name, count] of this.stats) {
      profileCounts[name] = count;
    }

    const circuitBreakerStates: Record<string, CircuitBreakerState> = {};
    for (const [name, state] of this.circuitBreakerStates) {
      circuitBreakerStates[name] = { ...state };
    }

    // Calculate current TPM for each profile (Phase 4, Issue #489)
    const currentTPM: Record<string, number> = {};
    for (const subProfile of this.config.subProfiles) {
      currentTPM[subProfile.name] = this.calculateTPM(subProfile.name);
    }

    // Get backend metrics (Phase 5, Issue #489)
    const backendMetricsRecord: Record<string, BackendMetrics> = {};
    for (const [name, metrics] of this.backendMetrics) {
      backendMetricsRecord[name] = { ...metrics };
    }

    return {
      profileName: this.config.profileName,
      totalRequests: this.totalRequests,
      lastSelected: this.lastSelected,
      profileCounts,
      backendMetrics: backendMetricsRecord,
      circuitBreakerStates,
      currentTPM,
    };
  }

  /**
   * Reset statistics (optional method for testing/debugging)
   * Phase 5: Stats Integration
   */
  resetStats(): void {
    this.stats.clear();
    this.lastSelected = null;
    this.totalRequests = 0;
  }

  /**
   * Extract failover settings from ephemeral settings
   * @plan PLAN-20251212issue488
   * @plan PLAN-20251212issue489 - Phase 1: Extended with advanced settings
   */
  private extractFailoverSettings(): FailoverSettings {
    const ephemeral = this.config.lbProfileEphemeralSettings ?? {};
    return {
      retryCount: Math.min(
        typeof ephemeral.failover_retry_count === 'number'
          ? ephemeral.failover_retry_count
          : 1,
        100,
      ),
      retryDelayMs:
        typeof ephemeral.failover_retry_delay_ms === 'number'
          ? ephemeral.failover_retry_delay_ms
          : 0,
      failoverOnNetworkErrors: ephemeral.failover_on_network_errors !== false,
      failoverStatusCodes: Array.isArray(ephemeral.failover_status_codes)
        ? ephemeral.failover_status_codes.filter(
            (n): n is number => typeof n === 'number',
          )
        : undefined,
      // Advanced failover settings (Phase 3, Issue #489)
      tpmThreshold:
        typeof ephemeral.tpm_threshold === 'number'
          ? ephemeral.tpm_threshold
          : undefined,
      timeoutMs:
        typeof ephemeral.timeout_ms === 'number'
          ? ephemeral.timeout_ms
          : undefined,
      circuitBreakerEnabled: ephemeral.circuit_breaker_enabled === true,
      circuitBreakerFailureThreshold:
        typeof ephemeral.circuit_breaker_failure_threshold === 'number'
          ? ephemeral.circuit_breaker_failure_threshold
          : 3,
      circuitBreakerFailureWindowMs:
        typeof ephemeral.circuit_breaker_failure_window_ms === 'number'
          ? ephemeral.circuit_breaker_failure_window_ms
          : 60000,
      circuitBreakerRecoveryTimeoutMs:
        typeof ephemeral.circuit_breaker_recovery_timeout_ms === 'number'
          ? ephemeral.circuit_breaker_recovery_timeout_ms
          : 30000,
    };
  }

  /**
   * Determine if error should trigger failover
   * @plan PLAN-20251212issue488
   */
  private shouldFailover(error: unknown, settings: FailoverSettings): boolean {
    if (!(error instanceof Error)) return true;

    if (settings.failoverOnNetworkErrors && isNetworkTransientError(error)) {
      return true;
    }

    const status = getErrorStatus(error);
    if (status !== undefined) {
      if (settings.failoverStatusCodes) {
        return settings.failoverStatusCodes.includes(status);
      }
      return status === 429 || (status >= 500 && status < 600);
    }

    return true;
  }

  /**
   * Build resolved options for a sub-profile
   * @plan PLAN-20251212issue488
   */
  private buildResolvedOptions(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
  ): GenerateChatOptions {
    return {
      ...options,
      resolved: {
        ...options.resolved,
        model: isResolvedSubProfile(subProfile)
          ? subProfile.model
          : (subProfile.modelId ?? ''),
        ...(subProfile.baseURL && { baseURL: subProfile.baseURL }),
        ...(subProfile.authToken && { authToken: subProfile.authToken }),
      },
    };
  }

  /**
   * Initialize circuit breaker state for a backend
   * @plan PLAN-20251212issue489 - Phase 2
   */
  private initCircuitBreakerState(_profileName: string): CircuitBreakerState {
    return {
      state: 'closed',
      failures: [],
    };
  }

  /**
   * Check if backend is healthy (circuit breaker check)
   * @plan PLAN-20251212issue489 - Phase 2
   */
  private isBackendHealthy(profileName: string): boolean {
    const settings = this.extractFailoverSettings();
    if (!settings.circuitBreakerEnabled) return true;

    const state = this.circuitBreakerStates.get(profileName);
    if (!state || state.state === 'closed') return true;

    if (state.state === 'open') {
      const now = Date.now();
      const recoveryTimeout = settings.circuitBreakerRecoveryTimeoutMs;
      if (state.openedAt && now - state.openedAt >= recoveryTimeout) {
        state.state = 'half-open';
        state.lastAttempt = now;
        this.logger.debug(
          () => `[circuit-breaker] ${profileName}: Testing recovery`,
        );
        return true;
      }
      return false;
    }

    // half-open: allow one attempt
    return true;
  }

  /**
   * Record successful backend request (circuit breaker)
   * @plan PLAN-20251212issue489 - Phase 2
   */
  private recordBackendSuccess(profileName: string): void {
    const state = this.circuitBreakerStates.get(profileName);
    if (state && state.state === 'half-open') {
      state.state = 'closed';
      state.failures = [];
      this.logger.debug(() => `[circuit-breaker] ${profileName}: Recovered`);
    }
  }

  /**
   * Record backend failure (circuit breaker)
   * @plan PLAN-20251212issue489 - Phase 2
   */
  private recordBackendFailure(profileName: string, error: Error): void {
    const settings = this.extractFailoverSettings();
    if (!settings.circuitBreakerEnabled) return;

    let state = this.circuitBreakerStates.get(profileName);
    if (!state) {
      state = this.initCircuitBreakerState(profileName);
      this.circuitBreakerStates.set(profileName, state);
    }

    const now = Date.now();
    state.failures.push({ timestamp: now, error });

    // Prune old failures outside window
    state.failures = state.failures.filter(
      (f) => now - f.timestamp < settings.circuitBreakerFailureWindowMs,
    );

    // Check if threshold exceeded
    if (state.failures.length >= settings.circuitBreakerFailureThreshold) {
      state.state = 'open';
      state.openedAt = now;
      this.logger.debug(
        () =>
          `[circuit-breaker] ${profileName}: Marked unhealthy (${state.failures.length} failures in window)`,
      );
    }
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
    if (!timeoutMs || timeoutMs <= 0) {
      yield* iterator;
      return;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      // Race first chunk against timeout
      const iteratorResult = iterator.next();
      const firstResult = await Promise.race([iteratorResult, timeoutPromise]);

      // Got first chunk, clear timeout
      if (timeoutHandle) clearTimeout(timeoutHandle);

      if (!firstResult.done) {
        yield firstResult.value;
      }

      // Yield remaining chunks (no timeout after first chunk)
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
        yield chunk;
      }
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.logger.debug(
        () =>
          `[LB:timeout] ${profileName}: Request timed out after ${timeoutMs}ms`,
      );
      throw error;
    }
  }

  /**
   * Check if error is a timeout error
   * @plan PLAN-20251212issue489 - Phase 3
   */
  private isTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('Request timeout');
  }

  /**
   * Update TPM tracking with new tokens
   * @plan PLAN-20251212issue489 - Phase 4
   */
  private updateTPM(profileName: string, tokensUsed: number): void {
    const now = Date.now();
    const minute = Math.floor(now / 60000);

    let bucket = this.tpmBuckets.get(minute);
    if (!bucket) {
      bucket = new Map();
      this.tpmBuckets.set(minute, bucket);
    }

    const current = bucket.get(profileName) || 0;
    bucket.set(profileName, current + tokensUsed);

    // Clean up old buckets (> 5 minutes old)
    const cutoff = minute - 5;
    for (const [bucketMinute] of this.tpmBuckets) {
      if (bucketMinute < cutoff) {
        this.tpmBuckets.delete(bucketMinute);
      }
    }
  }

  /**
   * Calculate TPM for a profile using 5-minute rolling window
   * @plan PLAN-20251212issue489 - Phase 4
   */
  private calculateTPM(profileName: string): number {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);

    let totalTokens = 0;
    let oldestBucket: number | undefined;

    // Sum tokens from last 5 minutes and track oldest bucket
    for (let i = 0; i < 5; i++) {
      const minute = currentMinute - i;
      const bucket = this.tpmBuckets.get(minute);
      if (bucket) {
        const tokens = bucket.get(profileName) || 0;
        if (tokens > 0) {
          totalTokens += tokens;
          if (oldestBucket === undefined || minute < oldestBucket) {
            oldestBucket = minute;
          }
        }
      }
    }

    // No tokens tracked yet
    if (totalTokens === 0 || oldestBucket === undefined) {
      return 0;
    }

    // Calculate TPM from oldest bucket to current minute (elapsed time)
    // This ensures TPM decreases as time passes with no new tokens
    const elapsedMinutes = currentMinute - oldestBucket + 1;

    // Return tokens per minute averaged over elapsed time
    return totalTokens / elapsedMinutes;
  }

  /**
   * Check if backend should be skipped due to low TPM
   * @plan PLAN-20251212issue489 - Phase 4
   */
  private shouldSkipOnTPM(
    profileName: string,
    tpmThreshold: number | undefined,
  ): boolean {
    if (!tpmThreshold || tpmThreshold <= 0) return false;

    const currentTPM = this.calculateTPM(profileName);
    // Only skip if we have some history and TPM is below threshold
    if (currentTPM > 0 && currentTPM < tpmThreshold) {
      this.logger.debug(
        () =>
          `[LB:tpm] ${profileName}: TPM (${currentTPM.toFixed(0)}) below threshold (${tpmThreshold})`,
      );
      return true;
    }

    return false;
  }

  /**
   * Extract token count from response chunks
   * @plan PLAN-20251212issue489 - Phase 4/5
   */
  private extractTokenCount(chunks: IContent[]): number {
    if (!chunks || chunks.length === 0) return 0;

    // Look for usage information in the last chunk (common pattern)
    const lastChunk = chunks[chunks.length - 1] as unknown as Record<
      string,
      unknown
    >;

    // Gemini format: usageMetadata.promptTokenCount, usageMetadata.candidatesTokenCount
    if (lastChunk.usageMetadata) {
      const usageMetadata = lastChunk.usageMetadata as Record<string, unknown>;
      const promptTokenCount =
        typeof usageMetadata.promptTokenCount === 'number'
          ? usageMetadata.promptTokenCount
          : 0;
      const candidatesTokenCount =
        typeof usageMetadata.candidatesTokenCount === 'number'
          ? usageMetadata.candidatesTokenCount
          : 0;
      if (promptTokenCount > 0 || candidatesTokenCount > 0) {
        return promptTokenCount + candidatesTokenCount;
      }
    }

    // Anthropic format: usage.input_tokens, usage.output_tokens
    if (lastChunk.usage) {
      const usage = lastChunk.usage as Record<string, unknown>;
      const inputTokens =
        typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
      const outputTokens =
        typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
      if (inputTokens > 0 || outputTokens > 0) {
        return inputTokens + outputTokens;
      }

      // OpenAI format: usage.prompt_tokens, usage.completion_tokens
      const promptTokens =
        typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
      const completionTokens =
        typeof usage.completion_tokens === 'number'
          ? usage.completion_tokens
          : 0;
      if (promptTokens > 0 || completionTokens > 0) {
        return promptTokens + completionTokens;
      }
    }

    // Fallback: No token information found, return 0
    return 0;
  }

  /**
   * Initialize backend metrics
   * @plan PLAN-20251212issue489 - Phase 5
   */
  private initBackendMetrics(_profileName: string): BackendMetrics {
    return {
      requests: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      tokens: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
    };
  }

  /**
   * Record request start and return start time
   * @plan PLAN-20251212issue489 - Phase 5
   */
  private recordRequestStart(profileName: string): number {
    let metrics = this.backendMetrics.get(profileName);
    if (!metrics) {
      metrics = this.initBackendMetrics(profileName);
      this.backendMetrics.set(profileName, metrics);
    }
    metrics.requests++;
    return Date.now();
  }

  /**
   * Record successful request
   * @plan PLAN-20251212issue489 - Phase 5
   */
  private recordRequestSuccess(
    profileName: string,
    startTime: number,
    tokensUsed: number,
  ): void {
    const metrics = this.backendMetrics.get(profileName);
    if (!metrics) return;

    const latency = Date.now() - startTime;
    metrics.successes++;
    metrics.tokens += tokensUsed;
    metrics.totalLatencyMs += latency;
    metrics.avgLatencyMs = metrics.totalLatencyMs / metrics.requests;
  }

  /**
   * Record failed request
   * @plan PLAN-20251212issue489 - Phase 5
   */
  private recordRequestFailure(
    profileName: string,
    startTime: number,
    error: Error,
  ): void {
    const metrics = this.backendMetrics.get(profileName);
    if (!metrics) return;

    const latency = Date.now() - startTime;
    metrics.failures++;
    metrics.totalLatencyMs += latency;
    metrics.avgLatencyMs = metrics.totalLatencyMs / metrics.requests;

    if (this.isTimeoutError(error)) {
      metrics.timeouts++;
    }
  }

  /**
   * Execute with failover strategy
   * @plan PLAN-20251212issue488
   * @plan PLAN-20251212issue489 - Phase 2: Updated with circuit breaker integration
   */
  private async *executeWithFailover(
    options: GenerateChatOptions,
  ): AsyncGenerator<IContent> {
    const settings = this.extractFailoverSettings();
    const errors: Array<{ profile: string; error: Error }> = [];

    // Check if all backends are unhealthy (circuit breakers open)
    if (settings.circuitBreakerEnabled) {
      const allUnhealthy = this.config.subProfiles.every(
        (sp) => !this.isBackendHealthy(sp.name),
      );
      if (allUnhealthy) {
        throw new Error(
          'All backends are currently unhealthy (circuit breakers open). Please wait for recovery or check backend configurations.',
        );
      }
    }

    for (const subProfile of this.config.subProfiles) {
      // Skip unhealthy backends (circuit breaker check)
      if (!this.isBackendHealthy(subProfile.name)) {
        this.logger.debug(
          () =>
            `[LB:failover] Skipping unhealthy backend: ${subProfile.name} (circuit breaker open)`,
        );
        continue;
      }

      // Skip backends with low TPM (Phase 4, Issue #489)
      if (this.shouldSkipOnTPM(subProfile.name, settings.tpmThreshold)) {
        this.logger.debug(
          () =>
            `[LB:failover] Skipping backend: ${subProfile.name} (TPM below threshold)`,
        );
        continue;
      }

      let attempts = 0;
      const maxAttempts = Math.max(1, settings.retryCount);

      while (attempts < maxAttempts) {
        attempts++;
        // Record request start (Phase 5, Issue #489)
        const startTime = this.recordRequestStart(subProfile.name);
        try {
          this.logger.debug(
            () =>
              `[LB:failover] Trying backend: ${subProfile.name} (attempt ${attempts}/${maxAttempts})`,
          );

          const resolvedOptions = this.buildResolvedOptions(
            subProfile,
            options,
          );
          const delegateProvider = this.providerManager.getProviderByName(
            subProfile.providerName,
          );
          if (!delegateProvider) {
            throw new Error(`Provider "${subProfile.providerName}" not found`);
          }

          const rawIterator =
            delegateProvider.generateChatCompletion(resolvedOptions);
          // Wrap with timeout (Phase 3, Issue #489)
          const iterator = this.wrapWithTimeout(
            rawIterator,
            settings.timeoutMs,
            subProfile.name,
          );

          // Collect chunks for token extraction (Phase 4, Issue #489)
          const chunks: IContent[] = [];
          for await (const chunk of iterator) {
            chunks.push(chunk);
            yield chunk;
          }

          // Extract and update TPM (Phase 4, Issue #489)
          const tokensUsed = this.extractTokenCount(chunks);
          if (tokensUsed > 0) {
            this.updateTPM(subProfile.name, tokensUsed);
          }

          // Record request success (Phase 5, Issue #489)
          this.recordRequestSuccess(subProfile.name, startTime, tokensUsed);

          this.incrementStats(subProfile.name);
          this.recordBackendSuccess(subProfile.name);
          this.logger.debug(
            () => `[LB:failover] Success on backend: ${subProfile.name}`,
          );
          return;
        } catch (error) {
          const isLastAttempt = attempts >= maxAttempts;
          const shouldRetry =
            !isLastAttempt && this.shouldFailover(error, settings);

          if (shouldRetry) {
            if (settings.retryDelayMs > 0) {
              this.logger.debug(
                () =>
                  `[LB:failover] ${subProfile.name} attempt ${attempts} failed, retrying after ${settings.retryDelayMs}ms: ${(error as Error).message}`,
              );
              await new Promise((resolve) =>
                setTimeout(resolve, settings.retryDelayMs),
              );
            }
          } else {
            this.logger.debug(
              () =>
                `[LB:failover] ${subProfile.name} failed after ${attempts} attempts: ${(error as Error).message}`,
            );
            // Record request failure (Phase 5, Issue #489)
            this.recordRequestFailure(
              subProfile.name,
              startTime,
              error as Error,
            );
            this.recordBackendFailure(subProfile.name, error as Error);
            errors.push({ profile: subProfile.name, error: error as Error });
            break;
          }
        }
      }
    }

    throw new LoadBalancerFailoverError(this.config.profileName, errors);
  }

  /**
   * Get auth token - required by ProviderManager.normalizeRuntimeInputs validation
   * @plan:PLAN-20251211issue486b - Auth token resolution
   *
   * The load-balancer doesn't use this token directly; it passes authToken
   * via options.resolved to the delegate provider. This method exists to
   * satisfy ProviderManager's canResolveAuth check so it doesn't fail
   * validation before delegation can happen.
   */
  async getAuthToken(): Promise<string> {
    // Return the first sub-profile's auth token if available
    // This satisfies ProviderManager validation; actual auth is passed per-request
    const firstSubProfile = this.config.subProfiles[0];
    return firstSubProfile?.authToken ?? '';
  }
}
