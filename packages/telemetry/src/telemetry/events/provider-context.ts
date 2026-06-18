/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CompletedToolCallShape,
  DiffStat,
} from '../../internal/interfaces.js';

interface McpToolTelemetryShape {
  serverName: unknown;
  serverToolName: unknown;
}

interface DiffStatContainer {
  diffStat?: DiffStat;
}

export function isMcpToolTelemetryShape(
  tool: unknown,
): tool is McpToolTelemetryShape {
  if (typeof tool !== 'object' || tool === null) {
    return false;
  }
  return 'serverName' in tool && 'serverToolName' in tool;
}

export function hasDiffStat(
  resultDisplay: unknown,
): resultDisplay is DiffStatContainer {
  if (typeof resultDisplay !== 'object' || resultDisplay === null) {
    return false;
  }
  return 'diffStat' in resultDisplay;
}

export function isCompletedToolCallShapeWithTool(
  call: CompletedToolCallShape,
): boolean {
  return isMcpToolTelemetryShape(call.tool);
}

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
