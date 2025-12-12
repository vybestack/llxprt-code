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
 */
export interface LoadBalancingProviderConfig {
  profileName: string;
  strategy: 'round-robin';
  subProfiles: ResolvedSubProfile[] | LoadBalancerSubProfile[];
  lbProfileEphemeralSettings?: Record<string, unknown>;
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
 * Load balancing provider that distributes requests across multiple sub-profiles
 */
export class LoadBalancingProvider implements IProvider {
  readonly name = 'load-balancer';
  private roundRobinIndex = 0;
  private readonly logger = new DebugLogger('llxprt:providers:load-balancer');
  private stats: Map<string, number> = new Map();
  private lastSelected: string | null = null;
  private totalRequests = 0;

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
    if (config.strategy !== 'round-robin') {
      throw new Error(
        `Invalid strategy "${config.strategy}". Only "round-robin" is currently supported.`,
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

    // Phase 3 Step 1: Select next sub-profile using round-robin
    const subProfile = this.selectNextSubProfile();
    this.logger.debug(
      () => `Selected sub-profile: ${subProfile.name} for request`,
    );

    // Phase 5: Track stats for selected sub-profile
    this.incrementStats(subProfile.name);

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
    yield* delegateProvider.generateChatCompletion(resolvedOptions);
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
   */
  getStats(): LoadBalancerStats {
    const profileCounts: Record<string, number> = {};
    for (const [name, count] of this.stats) {
      profileCounts[name] = count;
    }
    return {
      profileName: this.config.profileName,
      totalRequests: this.totalRequests,
      lastSelected: this.lastSelected,
      profileCounts,
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
