/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class KittySequenceOverflowEvent {
  'event.name': 'kitty_sequence_overflow';
  'event.timestamp': string;
  sequence_length: number;
  sequence: string;

  constructor(sequence_length: number, sequence: string) {
    this['event.name'] = 'kitty_sequence_overflow';
    this['event.timestamp'] = new Date().toISOString();
    this.sequence_length = sequence_length;
    this.sequence = sequence;
  }
}

export class TokenUsageEvent {
  'event.name': 'token_usage';
  'event.timestamp': string;
  provider: string;
  conversationId: string;
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;

  constructor(
    provider: string,
    conversationId: string,
    input: number,
    output: number,
    cache: number,
    tool: number,
    thought: number,
    total: number,
  ) {
    this['event.name'] = 'token_usage';
    this['event.timestamp'] = new Date().toISOString();
    this.provider = provider;
    this.conversationId = conversationId;
    this.input = input;
    this.output = output;
    this.cache = cache;
    this.tool = tool;
    this.thought = thought;
    this.total = total;
  }
}

export class PerformanceMetricsEvent {
  'event.name': 'performance_metrics';
  'event.timestamp': string;
  provider: string;
  tokensPerMinute: number;
  throttleWaitTimeMs: number;
  totalRequests: number;
  errorRate: number;

  constructor(
    provider: string,
    tokensPerMinute: number,
    throttleWaitTimeMs: number,
    totalRequests: number,
    errorRate: number,
  ) {
    this['event.name'] = 'performance_metrics';
    this['event.timestamp'] = new Date().toISOString();
    this.provider = provider;
    this.tokensPerMinute = tokensPerMinute;
    this.throttleWaitTimeMs = throttleWaitTimeMs;
    this.totalRequests = totalRequests;
    this.errorRate = errorRate;
  }
}

export class ModelRoutingEvent {
  model: string;
  source: string;
  contextLimit: number;
  reason?: string;
  fallback: boolean;
  error?: unknown;

  constructor(
    model: string,
    source: string,
    contextLimit: number,
    reason?: string,
    fallback: boolean = false,
    error?: unknown,
  ) {
    this.model = model;
    this.source = source;
    this.contextLimit = contextLimit;
    this.reason = reason;
    this.fallback = fallback;
    this.error = error;
  }
}
