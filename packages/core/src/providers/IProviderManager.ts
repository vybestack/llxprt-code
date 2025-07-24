/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider } from './IProvider.js';
import { IModel } from './IModel.js';

/**
 * Manager for handling multiple providers
 */
export interface IProviderManager {
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
   * Get available models from a provider
   */
  getAvailableModels(providerName?: string): Promise<IModel[]>;

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
}
