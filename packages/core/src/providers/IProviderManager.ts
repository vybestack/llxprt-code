/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider } from './IProvider.js';

/**
 * Manager for handling multiple providers
 */
export interface IProviderManager {
  /**
   * Check if a provider is currently active
   */
  hasActiveProvider(): boolean;

  /**
   * Get the currently active provider
   */
  getActiveProvider(): IProvider | null;

  /**
   * Get the name of the active provider
   */
  getActiveProviderName(): string;
}