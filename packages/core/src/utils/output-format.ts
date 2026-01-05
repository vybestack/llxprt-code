/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionMetrics } from '../telemetry/uiTelemetry.js';

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
}

export interface JsonOutput {
  response?: string;
  stats?: SessionMetrics;
  error?: JsonError;
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
    return JSON.stringify(
      {
        error: {
          type: error.constructor.name,
          message: error.message,
          ...(code !== undefined && { code }),
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
    return JSON.stringify(event) + '\\n';
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
