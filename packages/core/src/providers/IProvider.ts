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

import { IModel } from './IModel.js';
import { ITool } from './ITool.js';
import { IContent } from '../services/history/IContent.js';
import type { SettingsService } from '../settings/SettingsService.js';
import type { Config } from '../config/config.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';

export type ProviderToolset = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
    parameters?: unknown;
  }>;
}>;

export interface GenerateChatOptions {
  contents: IContent[];
  tools?: ProviderToolset;
  settings?: SettingsService;
  config?: Config;
  runtime?: ProviderRuntimeContext;
  metadata?: Record<string, unknown>;
}

export interface IProvider {
  name: string;
  isDefault?: boolean;
  getModels(): Promise<IModel[]>;
  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 4-15
   */
  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    content: IContent[],
    tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent>;
  getCurrentModel?(): string;
  getDefaultModel(): string;
  // Methods for updating provider configuration
  getToolFormat?(): string;
  isPaidMode?(): boolean;
  // Method to clear any provider-specific state (e.g., conversation cache, tool call tracking)
  /**
   * @deprecated PLAN-20250218-STATELESSPROVIDER.P04: Prefer scoped runtime lifecycle hooks.
   */
  clearState?(): void;
  // Method to set the config instance (for providers that need it)
  /**
   * @deprecated PLAN-20250218-STATELESSPROVIDER.P04: Use GenerateChatOptions.config instead.
   */
  setConfig?(config: unknown): void;
  // ServerTool methods for provider-native tools
  getServerTools(): string[];
  invokeServerTool(
    toolName: string,
    params: unknown,
    config?: unknown,
  ): Promise<unknown>;
  // Add other methods as needed, e.g., generateCompletion, getToolDefinitions

  /**
   * Set model parameters to be included in API calls
   * @param params Parameters to merge with existing, or undefined to clear all
   */
  getModelParams?(): Record<string, unknown> | undefined;

  /**
   * Clear authentication cache (for OAuth logout)
   */
  /**
   * @deprecated PLAN-20250218-STATELESSPROVIDER.P04: Authentication cache is managed per runtime context.
   */
  clearAuthCache?(): void;

  /**
   * Clear authentication settings (keys and keyfiles)
   */
  /**
   * @deprecated PLAN-20250218-STATELESSPROVIDER.P04: Use runtime scoped authentication handlers.
   */
  clearAuth?(): void;
}

// Re-export the interfaces for convenience
export type { IModel, ITool };
