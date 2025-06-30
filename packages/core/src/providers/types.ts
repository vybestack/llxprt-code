/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Represents a message in a provider's format
 */
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ProviderToolCall[];
  // For tool messages (responses to tool calls)
  tool_call_id?: string;
  name?: string;
}

/**
 * Represents a tool call from a provider
 */
export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Represents a tool definition for providers
 */
export interface ProviderTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Provider interface for external AI providers
 */
export interface Provider {
  name: string;

  /**
   * Generate a chat completion
   * @param messages The conversation history
   * @param tools Available tools for the model to use
   * @returns An async iterator of response messages
   */
  generateChatCompletion(
    messages: ProviderMessage[],
    tools?: ProviderTool[],
  ): AsyncIterableIterator<ProviderMessage>;

  /**
   * Get the current model being used
   */
  getCurrentModel(): string;

  /**
   * Set the model to use
   */
  setModel(modelId: string): void;
}

/**
 * Manager for handling multiple providers
 */
export interface ProviderManager {
  /**
   * Check if a provider is currently active
   */
  hasActiveProvider(): boolean;

  /**
   * Get the currently active provider
   */
  getActiveProvider(): Provider | null;

  /**
   * Get the name of the active provider
   */
  getActiveProviderName(): string;
}
