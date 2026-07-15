/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionMetrics } from '../telemetry/uiTelemetry.js';
import {
  STRUCTURED_ERROR_CATEGORIES,
  STRUCTURED_ERROR_REASONS,
  type StructuredErrorCategory,
  type StructuredErrorReason,
} from '../core/turn.js';

/**
 * Output format for CLI responses
 */
export enum OutputFormat {
  TEXT = 'text',
  JSON = 'json',
  STREAM_JSON = 'stream-json',
}

export interface JsonError {
  type: string;
  message: string;
  code?: string | number;
  status?: number;
  category?: StructuredErrorCategory;
  reason?: StructuredErrorReason;
}

export interface JsonOutput {
  session_id?: string;
  response?: string;
  stats?: SessionMetrics;
  error?: JsonError;
  /**
   * Present only when the model's safety classifier declined the request
   * (issue #2329). Omitted on normal completion.
   */
  finish_reason?: 'refusal';
}

// Streaming JSON event types
export enum JsonStreamEventType {
  INIT = 'init',
  MESSAGE = 'message',
  TOOL_USE = 'tool_use',
  TOOL_RESULT = 'tool_result',
  ERROR = 'error',
  RESULT = 'result',
}

export interface BaseJsonStreamEvent {
  type: JsonStreamEventType;
  timestamp: string;
}

export interface InitEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.INIT;
  session_id: string;
  model: string;
}

export interface MessageEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.MESSAGE;
  role: 'user' | 'assistant';
  content: string;
  delta?: boolean;
}

export interface ToolUseEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.TOOL_USE;
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.TOOL_RESULT;
  tool_id: string;
  status: 'success' | 'error';
  output?: string;
  error?: {
    type: string;
    message: string;
  };
}

export interface ErrorEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.ERROR;
  severity: 'warning' | 'error';
  message: string;
  status?: number;
  category?: StructuredErrorCategory;
  reason?: StructuredErrorReason;
}

export interface StreamStats {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  tool_calls: number;
}

export interface ResultEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.RESULT;
  status: 'success' | 'error';
  error?: {
    type: string;
    message: string;
  };
  stats?: StreamStats;
}

export type JsonStreamEvent =
  | InitEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent
  | ResultEvent;

export function getSafeStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  return typeof error.status === 'number' ? error.status : undefined;
}

function includesString<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === 'string' && values.some((item) => item === value);
}

function isStructuredErrorCategory(
  value: unknown,
): value is StructuredErrorCategory {
  return includesString(STRUCTURED_ERROR_CATEGORIES, value);
}

function isStructuredErrorReason(
  value: unknown,
): value is StructuredErrorReason {
  return includesString(STRUCTURED_ERROR_REASONS, value);
}

export function getSafeCategory(
  error: unknown,
): StructuredErrorCategory | undefined {
  if (typeof error !== 'object' || error === null || !('category' in error)) {
    return undefined;
  }
  return isStructuredErrorCategory(error.category) ? error.category : undefined;
}

export function getSafeReason(
  error: unknown,
): StructuredErrorReason | undefined {
  if (typeof error !== 'object' || error === null || !('reason' in error)) {
    return undefined;
  }
  return isStructuredErrorReason(error.reason) ? error.reason : undefined;
}

/**
 * Formats errors as JSON for programmatic consumption
 */
export class JsonFormatter {
  /**
   * Formats an error object as JSON
   * @param error - The error to format
   * @param code - Optional error code
   * @returns JSON string representation of the error
   */
  formatError(error: Error, code?: string | number): string {
    const status = getSafeStatus(error);
    const category = getSafeCategory(error);
    const reason = getSafeReason(error);
    return JSON.stringify(
      {
        error: {
          type: error.constructor.name,
          message: error.message,
          ...(code !== undefined && { code }),
          ...(status !== undefined && { status }),
          ...(category !== undefined && { category }),
          ...(reason !== undefined && { reason }),
        },
      },
      null,
      2,
    );
  }
}

/**
 * Formatter for streaming JSON output.
 * Emits newline-delimited JSON (JSONL) events to stdout in real-time.
 */
export class StreamJsonFormatter {
  /**
   * Formats a single event as a JSON string with newline (JSONL format).
   * @param event - The stream event to format
   * @returns JSON string with trailing newline
   */
  formatEvent(event: JsonStreamEvent): string {
    return JSON.stringify(event) + '\n';
  }

  /**
   * Emits an event directly to stdout in JSONL format.
   * @param event - The stream event to emit
   */
  emitEvent(event: JsonStreamEvent): void {
    process.stdout.write(this.formatEvent(event));
  }

  /**
   * Converts SessionMetrics to simplified StreamStats format.
   * Aggregates token counts across all models.
   * @param metrics - The session metrics from telemetry
   * @param durationMs - The session duration in milliseconds
   * @returns Simplified stats for streaming output
   */
  convertToStreamStats(
    metrics: SessionMetrics,
    durationMs: number,
  ): StreamStats {
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    // Aggregate token counts across all models
    for (const modelMetrics of Object.values(metrics.models)) {
      totalTokens += modelMetrics.tokens.total;
      inputTokens += modelMetrics.tokens.prompt;
      outputTokens += modelMetrics.tokens.candidates;
    }

    return {
      total_tokens: totalTokens,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
      tool_calls: metrics.tools.totalCalls,
    };
  }
}
