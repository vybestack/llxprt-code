/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Neutral contracts for one scheduled tool execution (issue #4084): who the
 * call belongs to, and what a tool may tell a programmatic caller about its
 * output in addition to the model-facing text.
 */

import type { ParsedToolOutputMaxTokens } from '../utils/toolOutputMaxTokens.js';

/** JSON data a tool may hand to a programmatic caller. */
export type ToolStructuredValue =
  | null
  | boolean
  | number
  | string
  | readonly ToolStructuredValue[]
  | { readonly [key: string]: ToolStructuredValue };

export type ToolStructuredOutput = {
  readonly [key: string]: ToolStructuredValue;
};

/**
 * Whether a result covers everything the request asked for. A producer that
 * cut its own output (line, byte, match or file limits) reports `partial`;
 * `complete` is reported only with evidence; anything else is `unknown`.
 */
export type ToolOutputCompleteness = 'complete' | 'partial' | 'unknown';

/**
 * Host-only port that lets a tool run nested tool calls through the caller's
 * own scheduler composition. Implemented by the agents package; tools never
 * construct it and a model can never supply it.
 */
export interface NestedToolExecution {
  readonly kind: 'nested-tool-execution';
}

/**
 * Immutable provenance of one scheduled execution, assembled by the scheduler
 * at the scheduler-to-invocation boundary. Absent when a tool is executed
 * outside a scheduler (for example a direct `buildAndExecute`).
 */
export interface ToolExecutionScope {
  readonly callId: string;
  readonly promptId: string;
  readonly agentId: string;
  /** `script` for calls made by a code mode script, `model` otherwise. */
  readonly origin: 'model' | 'script';
  /** Tool names a hook restricted this call's turn to, if any. */
  readonly hookRestrictedAllowedTools: readonly string[] | undefined;
  readonly nestedExecution: NestedToolExecution | undefined;
  /**
   * The model-facing output token budget of this call's result, after a
   * parallel batch divided `tool-output-max-tokens` among its calls. A tool
   * whose result must reach the model whole fits itself to it and marks the
   * result `boundedOutput`.
   */
  readonly modelOutputLimit: ParsedToolOutputMaxTokens;
}
