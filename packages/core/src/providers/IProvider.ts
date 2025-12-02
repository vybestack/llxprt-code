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
import type { RuntimeInvocationContext } from '../runtime/RuntimeInvocationContext.js';
import type {
  ProviderTelemetryContext,
  ResolvedAuthToken,
  UserMemoryInput,
} from './types/providerRuntime.js';

export type ProviderToolset = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
    parameters?: unknown;
  }>;
}>;

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P06
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement REQ-SP2-001
 * @requirement:REQ-SP4-002
 * @requirement:REQ-SP4-003
 * @pseudocode base-provider-call-contract.md lines 1-3
 * @pseudocode provider-runtime-handling.md lines 10-16
 */
export interface GenerateChatOptions {
  contents: IContent[];
  tools?: ProviderToolset;
  settings?: SettingsService;
  config?: Config;
  runtime?: ProviderRuntimeContext;
  invocation?: RuntimeInvocationContext;
  metadata?: Record<string, unknown>;
  resolved?: {
    model?: string;
    baseURL?: string;
    authToken?: ResolvedAuthToken;
    telemetry?: ProviderTelemetryContext;
    temperature?: number;
    maxTokens?: number;
    streaming?: boolean;
  };
  userMemory?: UserMemoryInput;
}

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P06
 * @requirement REQ-SP2-001
 * @pseudocode base-provider-call-contract.md lines 3-5
 */
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
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent>;
  getCurrentModel?(): string;
  getDefaultModel(): string;
  // Methods for updating provider configuration
  getToolFormat?(): string;
  isPaidMode?(): boolean;
  // ServerTool methods for provider-native tools
  getServerTools(): string[];
  invokeServerTool(
    toolName: string,
    params: unknown,
    config?: unknown,
    signal?: AbortSignal,
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
  clearAuthCache?(): void;

  /**
   * Clear authentication settings (keys and keyfiles)
   */
  clearAuth?(): void;
}

// Re-export the interfaces for convenience
export type { IModel, ITool };
