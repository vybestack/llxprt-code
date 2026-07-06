/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelStreamChunk } from '../llm-types/index.js';

export enum StreamEventType {
  /** A regular content chunk from the API. */
  CHUNK = 'chunk',
  /** A signal that a retry is about to happen. The UI should discard any partial
   * content from the attempt that just failed. */
  RETRY = 'retry',
  /** Agent execution was stopped by a hook. */
  AGENT_EXECUTION_STOPPED = 'agent_execution_stopped',
  /** Agent execution was blocked by a hook. */
  AGENT_EXECUTION_BLOCKED = 'agent_execution_blocked',
}

export type StreamEvent =
  | { type: StreamEventType.CHUNK; value: ModelStreamChunk }
  | { type: StreamEventType.RETRY }
  | {
      type: StreamEventType.AGENT_EXECUTION_STOPPED;
      reason: string;
      systemMessage?: string;
      contextCleared?: boolean;
    }
  | {
      type: StreamEventType.AGENT_EXECUTION_BLOCKED;
      reason: string;
      systemMessage?: string;
      contextCleared?: boolean;
    };

/**
 * Options for retrying due to invalid content from the model.
 */
export interface ContentRetryOptions {
  /** Total number of attempts to make (1 initial + N retries). */
  maxAttempts: number;
  /** The base delay in milliseconds for linear backoff. */
  initialDelayMs: number;
}

export const INVALID_CONTENT_RETRY_OPTIONS: ContentRetryOptions = {
  maxAttempts: 2, // 1 initial call + 1 retry
  initialDelayMs: 500,
};

/**
 * Custom error to signal that a stream completed with invalid content,
 * which should trigger a retry.
 */
export class InvalidStreamError extends Error {
  readonly type:
    | 'NO_FINISH_REASON'
    | 'NO_RESPONSE_TEXT'
    | 'NO_FINISH_REASON_NO_TEXT'
    | 'MALFORMED_FUNCTION_CALL';

  constructor(
    message: string,
    type:
      | 'NO_FINISH_REASON'
      | 'NO_RESPONSE_TEXT'
      | 'NO_FINISH_REASON_NO_TEXT'
      | 'MALFORMED_FUNCTION_CALL',
  ) {
    super(message);
    this.name = 'InvalidStreamError';
    this.type = type;
  }
}

/**
 * Legacy error class for backward compatibility.
 */
export class EmptyStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyStreamError';
  }
}

/** Visible for Testing */
export function isSchemaDepthError(errorMessage: string): boolean {
  return errorMessage.includes('maximum schema depth exceeded');
}
