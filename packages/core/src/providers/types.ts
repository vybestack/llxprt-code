/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Re-export the unified interfaces with backward compatible names
export type { IMessage as ProviderMessage } from './IMessage.js';
export type { ITool as ProviderTool } from './ITool.js';
export type { IProvider as Provider } from './IProvider.js';
export type { IProviderManager as ProviderManager } from './IProviderManager.js';

// Export the tool call type from IMessage
export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}
