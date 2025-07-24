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
import { IMessage } from './IMessage.js';

export interface IProvider {
  name: string;
  isDefault?: boolean;
  getModels(): Promise<IModel[]>;
  generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
  ): AsyncIterableIterator<unknown>;
  setModel?(modelId: string): void;
  getCurrentModel?(): string;
  // Methods for updating provider configuration
  setApiKey?(apiKey: string): void;
  setBaseUrl?(baseUrl?: string): void;
  getToolFormat?(): string;
  setToolFormatOverride?(format: string | null): void;
  isPaidMode?(): boolean;
  // Method to clear any provider-specific state (e.g., conversation cache, tool call tracking)
  clearState?(): void;
  // Method to set the config instance (for providers that need it)
  setConfig?(config: unknown): void;
  // ServerTool methods for provider-native tools
  getServerTools(): string[];
  invokeServerTool(
    toolName: string,
    params: unknown,
    config?: unknown,
  ): Promise<unknown>;
  // Add other methods as needed, e.g., generateCompletion, getToolDefinitions
}

// Re-export the interfaces for convenience
export type { IModel, ITool, IMessage };
