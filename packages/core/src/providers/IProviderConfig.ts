/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration interface for providers
 * This replaces the CLI-specific Settings type
 */
export interface IProviderConfig {
  /**
   * Tool format configuration
   */
  toolFormat?: {
    openAI?: 'auto' | 'gemma' | 'llama' | 'functionary' | 'hermes';
  };

  /**
   * Whether to use OpenAI responses API
   */
  openAIUseResponsesApi?: boolean;

  /**
   * Model configuration
   */
  defaultModel?: string;

  /**
   * Telemetry configuration
   */
  telemetry?: {
    enabled?: boolean;
  };
}
