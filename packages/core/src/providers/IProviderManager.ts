/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type IProvider } from './IProvider.js';
import { type HydratedModel } from '../models/hydration.js';
import { Config } from '../config/config.js';

/**
 * Manager for handling multiple providers
 */
export interface IProviderManager {
  /**
   * Set the configuration for the provider manager
   */
  setConfig(config: Config): void;
  /**
   * Register a provider
   */
  registerProvider(provider: IProvider): void;

  /**
   * Set the active provider by name
   */
  setActiveProvider(name: string): void;

  /**
   * Clear the active provider
   */
  clearActiveProvider(): void;

  /**
   * Check if a provider is currently active
   */
  hasActiveProvider(): boolean;

  /**
   * Get the currently active provider
   * @throws Error if no active provider is set
   */
  getActiveProvider(): IProvider;

  /**
   * Get the name of the active provider
   */
  getActiveProviderName(): string;

  /**
   * Get available models from a provider, hydrated with models.dev data.
   *
   * Models are first fetched from provider.getModels(), then enriched with
   * capabilities, pricing, and metadata from models.dev registry.
   * If hydration fails, models are still returned with `hydrated: false`.
   */
  getAvailableModels(providerName?: string): Promise<HydratedModel[]>;

  /**
   * List all registered providers
   */
  listProviders(): string[];

  /**
   * Get the server tools provider (typically Gemini for web search)
   */
  getServerToolsProvider(): IProvider | null;

  /**
   * Set the server tools provider
   */
  setServerToolsProvider(provider: IProvider | null): void;

  /**
   * Accumulate token usage for a session
   */
  accumulateSessionTokens(
    providerName: string,
    usage: {
      input: number;
      output: number;
      cache: number;
      tool: number;
      thought: number;
    },
  ): void;

  /**
   * Get token usage for the current session
   */
  getSessionTokenUsage(): {
    input: number;
    output: number;
    cache: number;
    tool: number;
    thought: number;
    total: number;
  };

  /**
   * Get provider performance metrics
   */
  getProviderMetrics(providerName?: string): {
    tokensPerMinute: number;
    throttleWaitTimeMs: number;
  } | null;

  /**
   * Reset token usage for the current session
   */
  resetSessionTokenUsage(): void;
}
