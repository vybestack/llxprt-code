/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Provider configuration interface that provides a subset of settings
 * required by provider implementations.
 */
export interface IProviderConfig {
  /**
   * API key for authenticating with the provider.
   */
  apiKey?: string;

  /**
   * Base URL for the provider's API endpoint.
   * If not provided, the provider's default endpoint will be used.
   */
  baseUrl?: string;

  /**
   * Default model to use for this provider.
   */
  defaultModel?: string;

  /**
   * Maximum number of tokens to generate in a single request.
   */
  maxTokens?: number;

  /**
   * Temperature setting for response generation (0.0 - 2.0).
   */
  temperature?: number;

  /**
   * Whether to enable streaming responses.
   */
  streaming?: boolean;

  /**
   * Request timeout in milliseconds.
   */
  timeout?: number;

  /**
   * Custom headers to include in API requests.
   */
  customHeaders?: Record<string, string>;

  /**
   * Whether to enable text-based tool call parsing for models that
   * don't natively support function calling.
   */
  enableTextToolCallParsing?: boolean;

  /**
   * List of model IDs that require text-based tool call parsing.
   */
  textToolCallModels?: string[];

  /**
   * Override tool format for specific providers.
   * Maps provider name to tool format.
   */
  providerToolFormatOverrides?: Record<string, string>;

  /**
   * Whether to enable OpenAI Responses API for compatible models.
   */
  openaiResponsesEnabled?: boolean;

  /**
   * Organization ID for providers that support organization-level access.
   */
  organizationId?: string;

  /**
   * Project ID for providers that support project-level access.
   */
  projectId?: string;

  /**
   * Retry configuration for failed requests.
   */
  retryConfig?: {
    /**
     * Maximum number of retry attempts.
     */
    maxRetries?: number;
    /**
     * Base delay in milliseconds between retries.
     */
    retryDelay?: number;
    /**
     * Whether to use exponential backoff.
     */
    exponentialBackoff?: boolean;
  };

  /**
   * Provider-specific configuration options.
   * This allows for flexibility when different providers need unique settings.
   */
  providerSpecific?: Record<string, unknown>;
}
