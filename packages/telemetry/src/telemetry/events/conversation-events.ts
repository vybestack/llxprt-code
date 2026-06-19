/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ProviderCapabilities,
  ProviderContext,
  ProviderPerformanceMetrics,
  ToolCall,
} from './provider-context.js';

export class ConversationRequestEvent {
  'event.name': 'conversation_request';
  'event.timestamp': string;
  provider_name: string;
  conversation_id: string;
  turn_number: number;
  prompt_id: string;
  redacted_messages: unknown[];
  redacted_tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description?: string;
      parameters?: unknown;
    }>;
  }>;
  tool_format?: string;
  provider_switched?: boolean;

  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_messages: unknown[],
    redacted_tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
    tool_format?: string,
    provider_switched?: boolean,
  ) {
    this['event.name'] = 'conversation_request';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.conversation_id = conversation_id;
    this.turn_number = turn_number;
    this.prompt_id = prompt_id;
    this.redacted_messages = redacted_messages;
    this.redacted_tools = redacted_tools;
    this.tool_format = tool_format;
    this.provider_switched = provider_switched;
  }
}

export class ConversationResponseEvent {
  'event.name': 'conversation_response';
  'event.timestamp': string;
  provider_name: string;
  conversation_id: string;
  turn_number: number;
  prompt_id: string;
  redacted_content: string;
  duration_ms: number;
  success: boolean;
  error?: string;
  tool_calls?: unknown[];

  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_content: string,
    duration_ms: number,
    success: boolean,
    error?: string,
    tool_calls?: unknown[],
  ) {
    this['event.name'] = 'conversation_response';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.conversation_id = conversation_id;
    this.turn_number = turn_number;
    this.prompt_id = prompt_id;
    this.redacted_content = redacted_content;
    this.duration_ms = duration_ms;
    this.success = success;
    this.error = error;
    this.tool_calls = tool_calls;
  }
}

function createDefaultMetrics(
  providerName: string,
): ProviderPerformanceMetrics {
  return {
    providerName,
    totalRequests: 0,
    totalTokens: 0,
    averageLatency: 0,
    timeToFirstToken: null,
    tokensPerSecond: 0,
    tokensPerMinute: 0,
    throttleWaitTimeMs: 0,
    chunksReceived: 0,
    errorRate: 0,
    errors: [],
    sessionTokenUsage: {
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    },
  };
}

function createDefaultContext(providerName: string): ProviderContext {
  return {
    providerName,
    currentModel: 'unknown',
    toolFormat: 'unknown',
    isPaidMode: false,
    capabilities: {
      supportsStreaming: true,
      supportsTools: false,
      supportsVision: false,
      maxTokens: 4096,
      supportedFormats: [],
    },
    sessionStartTime: Date.now(),
  };
}

export class EnhancedConversationResponseEvent extends ConversationResponseEvent {
  provider_context: ProviderContext;
  performance_metrics: ProviderPerformanceMetrics;
  tool_calls_detailed: ToolCall[];

  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_content: string,
    duration_ms: number,
    success: boolean,
    error?: string,
    tool_calls?: ToolCall[],
    performance_metrics?: ProviderPerformanceMetrics,
    provider_context?: ProviderContext,
  ) {
    super(
      provider_name,
      conversation_id,
      turn_number,
      prompt_id,
      redacted_content,
      duration_ms,
      success,
      error,
      tool_calls,
    );

    this.tool_calls_detailed = tool_calls ?? [];
    this.performance_metrics =
      performance_metrics ?? createDefaultMetrics(provider_name);
    this.provider_context =
      provider_context ?? createDefaultContext(provider_name);
  }
}

export class ProviderSwitchEvent {
  'event.name': 'provider_switch';
  'event.timestamp': string;
  from_provider: string;
  to_provider: string;
  conversation_id: string;
  context_preserved: boolean;

  constructor(
    from_provider: string,
    to_provider: string,
    conversation_id: string,
    context_preserved: boolean,
  ) {
    this['event.name'] = 'provider_switch';
    this['event.timestamp'] = new Date().toISOString();
    this.from_provider = from_provider;
    this.to_provider = to_provider;
    this.conversation_id = conversation_id;
    this.context_preserved = context_preserved;
  }
}

export class ProviderCapabilityEvent {
  'event.name': 'provider_capability';
  'event.timestamp': string;
  provider_name: string;
  capabilities: ProviderCapabilities;
  context: ProviderContext;

  constructor(
    provider_name: string,
    capabilities: ProviderCapabilities,
    context: ProviderContext,
  ) {
    this['event.name'] = 'provider_capability';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.capabilities = capabilities;
    this.context = context;
  }
}
