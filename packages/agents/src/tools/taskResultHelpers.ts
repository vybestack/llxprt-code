/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ToolResult, ToolErrorType } from '@vybestack/llxprt-code-tools';
import { type OutputObject } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { DEFAULT_TASK_TIMEOUT_SECONDS } from './taskAbortHelpers.js';

const resultLogger = new DebugLogger('llxprt:task');

/**
 * Boundary-validation helper: coerces a possibly-missing `emitted_vars`
 * payload (subagent runtime data) to a string record, restoring the `?? {}`
 * fallback stripped by issue #2085.
 */
function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, string>;
  }
  return {};
}

/**
 * Formats a human readable summary for successful subagent execution.
 */
export function formatSuccessDisplay(
  subagentName: string,
  agentId: string,
  output: OutputObject,
): string {
  const emittedVars = Object.entries(asStringRecord(output.emitted_vars));
  const finalMessageSection = output.final_message
    ? `Final message:\n${output.final_message}`
    : 'Final message: _(none)_';
  const emittedSection =
    emittedVars.length === 0
      ? 'Emitted variables: _(none)_'
      : `Emitted variables:\n${emittedVars
          .map(([key, value]) => `- **${key}**: ${value}`)
          .join('\n')}`;

  return [
    `Subagent **${subagentName}** (\`${agentId}\`) completed with status \`${output.terminate_reason}\`.`,
    finalMessageSection,
    emittedSection,
  ].join('\n\n');
}

/**
 * Summarizes the subagent output as JSON for inclusion in tool history.
 */
export function formatSuccessContent(
  agentId: string,
  output: OutputObject,
): string {
  const payload: Record<string, unknown> = {
    agent_id: agentId,
    terminate_reason: output.terminate_reason,
    emitted_vars: asStringRecord(output.emitted_vars),
  };

  if (output.final_message !== undefined) {
    payload.final_message = output.final_message;
  }

  return JSON.stringify(payload, null, 2);
}

/**
 * Builds an error `ToolResult` from a thrown error, preferring the error's
 * message when present.
 */
export function createErrorResult(
  error: unknown,
  fallbackMessage: string,
  agentId?: string,
): ToolResult {
  const detail = error instanceof Error && error.message ? error.message : null;
  const displayMessage = detail
    ? `${fallbackMessage}\nDetails: ${detail}`
    : fallbackMessage;
  const message = detail ?? fallbackMessage;
  resultLogger.warn(() => `Task tool error: ${displayMessage}`);
  return {
    llmContent: displayMessage,
    returnDisplay: displayMessage,
    metadata: agentId
      ? {
          agentId,
          error: message,
        }
      : undefined,
    error: {
      message,
      type: ToolErrorType.UNHANDLED_EXCEPTION,
    },
  };
}

/**
 * Builds a cancelled `ToolResult`.
 */
export function createCancelledResult(
  message: string,
  agentId?: string,
  output?: OutputObject,
): ToolResult {
  resultLogger.warn(
    () =>
      `Task tool cancelled for agentId=${agentId ?? DEFAULT_AGENT_ID}: ${message}`,
  );
  return {
    llmContent: message,
    returnDisplay: message,
    metadata: {
      agentId: agentId ?? DEFAULT_AGENT_ID,
      terminateReason: output?.terminate_reason,
      emittedVars: output?.emitted_vars ?? {},
      ...(output?.final_message ? { finalMessage: output.final_message } : {}),
      cancelled: true,
    },
    error: {
      message,
      type: ToolErrorType.EXECUTION_FAILED,
    },
  };
}

/**
 * Builds a timeout `ToolResult`.
 */
export function createTimeoutResult(
  timeoutSeconds: number | undefined,
  output?: OutputObject,
  agentId?: string,
): ToolResult {
  const message = `Task timed out after ${timeoutSeconds ?? DEFAULT_TASK_TIMEOUT_SECONDS}s (timeout_seconds).`;
  return {
    llmContent: message,
    returnDisplay: message,
    metadata: {
      agentId: agentId ?? DEFAULT_AGENT_ID,
      terminateReason: output?.terminate_reason,
      emittedVars: output?.emitted_vars ?? {},
      ...(output?.final_message ? { finalMessage: output.final_message } : {}),
      timedOut: true,
    },
    error: {
      message,
      type: ToolErrorType.TIMEOUT,
    },
  };
}
