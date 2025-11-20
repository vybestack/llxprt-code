/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P04
 */

// Re-export the unified interfaces with backward compatible names
export type { IContent as ProviderMessage } from '../services/history/IContent.js';
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

// Enhanced provider capability types
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  maxTokens: number;
  supportedFormats: string[];
  hasModelSelection?: boolean;
  hasApiKeyConfig?: boolean;
  hasBaseUrlConfig?: boolean;
  supportsPaidMode?: boolean;
}

export interface ProviderContext {
  providerName: string;
  currentModel: string;
  toolFormat: string;
  isPaidMode: boolean;
  capabilities: ProviderCapabilities;
  sessionStartTime: number;
}

export interface ToolCall {
  provider: string;
  name: string;
  arguments: unknown;
  id: string;
}

/**
 * @plan PLAN-20250909-TOKTRACK.P08
 */
export interface ProviderPerformanceMetrics {
  providerName: string;
  totalRequests: number;
  totalTokens: number;
  averageLatency: number;
  timeToFirstToken: number | null;
  tokensPerSecond: number;
  tokensPerMinute: number;
  throttleWaitTimeMs: number;
  chunksReceived: number;
  errorRate: number;
  errors: Array<{ timestamp: number; duration: number; error: string }>;
  sessionTokenUsage: {
    input: number;
    output: number;
    cache: number;
    tool: number;
    thought: number;
    total: number;
  };
}

export interface ProviderComparison {
  provider1: string;
  provider2: string;
  capabilities: Record<string, ProviderCapabilities>;
  compatibility: number;
  recommendation: string;
}
