/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UsageMetadata } from '../types/usage-metadata.js';

export class ApiRequestEvent {
  'event.name': 'api_request';
  'event.timestamp': string;
  model: string;
  prompt_id: string;
  request_text?: string;

  constructor(model: string, prompt_id: string, request_text?: string) {
    this['event.name'] = 'api_request';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.prompt_id = prompt_id;
    this.request_text = request_text;
  }
}

export class ApiErrorEvent {
  'event.name': 'api_error';
  'event.timestamp': string;
  model: string;
  error: string;
  error_type?: string;
  status_code?: number | string;
  duration_ms: number;
  /** Monotonic timestamp (ms) when the request started */
  start_ms?: number;
  prompt_id: string;
  /** Stable per-attempt ID for deduplication */
  attempt_id?: string;
  provider?: string;
  time_to_first_token_ms?: number | null;
  last_token_ms?: number | null;
  input_token_count?: number;
  output_token_count?: number;
  cached_content_token_count?: number;
  thoughts_token_count?: number;
  tool_token_count?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number;
  usage_metadata_present?: boolean;
  /** True when emitted by the canonical provider wrapper (sole local-aggregation source). Agent/logical events leave this unset. */
  provider_owned?: boolean;

  constructor(
    model: string,
    error: string,
    duration_ms: number,
    prompt_id: string,
    error_type?: string,
    status_code?: number | string,
    attempt_id?: string,
  ) {
    this['event.name'] = 'api_error';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.error = error;
    this.error_type = error_type;
    this.status_code = status_code;
    this.duration_ms = duration_ms;
    this.prompt_id = prompt_id;
    if (attempt_id !== undefined) {
      this.attempt_id = attempt_id;
    }
  }
}

export class ApiResponseEvent {
  'event.name': 'api_response';
  'event.timestamp': string;
  model: string;
  status_code?: number | string;
  duration_ms: number;
  error?: string;
  /** Monotonic timestamp (ms) when the request started */
  start_ms?: number;
  input_token_count: number;
  output_token_count: number;
  cached_content_token_count: number;
  thoughts_token_count: number;
  tool_token_count: number;
  total_token_count: number;
  response_text?: string;
  prompt_id: string;
  finish_reasons: string[];
  /** Stable per-attempt ID for deduplication */
  attempt_id?: string;
  provider?: string;
  time_to_first_token_ms?: number | null;
  last_token_ms?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number;
  usage_metadata_present?: boolean;
  /** True when emitted by the canonical provider wrapper (sole local-aggregation source). Agent/logical events leave this unset. */
  provider_owned?: boolean;

  constructor(
    model: string,
    duration_ms: number,
    prompt_id: string,
    usage_data?: UsageMetadata,
    response_text?: string,
    error?: string,
    finish_reasons?: string[],
    attempt_id?: string,
  ) {
    this['event.name'] = 'api_response';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.duration_ms = duration_ms;
    this.status_code = 200;
    this.input_token_count = usage_data?.promptTokenCount ?? 0;
    this.output_token_count = usage_data?.candidatesTokenCount ?? 0;
    this.cached_content_token_count = usage_data?.cachedContentTokenCount ?? 0;
    this.thoughts_token_count = usage_data?.thoughtsTokenCount ?? 0;
    this.tool_token_count = usage_data?.toolUsePromptTokenCount ?? 0;
    this.total_token_count = usage_data?.totalTokenCount ?? 0;
    this.response_text = response_text;
    this.error = error;
    this.prompt_id = prompt_id;
    this.finish_reasons = finish_reasons ?? [];
    if (attempt_id !== undefined) {
      this.attempt_id = attempt_id;
    }
  }
}
