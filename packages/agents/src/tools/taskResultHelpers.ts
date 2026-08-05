/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { type ToolResult } from '@vybestack/llxprt-code-tools';
import { type OutputObject } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  TASK_TIMEOUT_DEFAULT_SETTING,
  TASK_TIMEOUT_MAX_SETTING,
} from './taskAbortHelpers.js';
import {
  describeTimeoutClamp,
  describeTimeoutTermination,
  type TimeoutResolution,
} from '@vybestack/llxprt-code-tools/utils/timeoutResolution.js';

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
 * Builds a timeout `ToolResult`. The message names the termination reason
 * (TIMEOUT), the effective timeout applied, and the parameter + settings that
 * would raise it (Issue #3031). The timeout is a finite `number`: a timeout
 * termination cannot be unbounded, because an unbounded run arms no timer and
 * therefore can never fire — callers obtain the value via
 * `requireEffectiveTimeoutSeconds`.
 */
export function createTimeoutResult(
  timeoutSeconds: number,
  output?: OutputObject,
  agentId?: string,
): ToolResult {
  const message = describeTimeoutTermination(timeoutSeconds, {
    defaultSetting: TASK_TIMEOUT_DEFAULT_SETTING,
    maxSetting: TASK_TIMEOUT_MAX_SETTING,
  });
  return {
    llmContent: message,
    returnDisplay: message,
    metadata: {
      agentId: agentId ?? DEFAULT_AGENT_ID,
      terminateReason: output?.terminate_reason ?? 'TIMEOUT',
      emittedVars: output?.emitted_vars ?? {},
      ...(output?.final_message ? { finalMessage: output.final_message } : {}),
      timedOut: true,
      effectiveTimeoutSeconds: timeoutSeconds,
    },
    error: {
      message,
      type: ToolErrorType.TIMEOUT,
    },
  };
}

/**
 * Attaches the resolved timeout metadata (`effectiveTimeoutSeconds`,
 * `requestedTimeoutSeconds`, `timeoutClamped`) to every task result, and —
 * when the requested/default value was reduced to the ceiling — appends the
 * clamp notice to the model-facing content so a caller that ignores metadata
 * still learns its request was not honoured (Issue #3031).
 */
export function attachTimeoutMetadata(
  result: ToolResult,
  resolution: TimeoutResolution,
  settings: { defaultSetting: string; maxSetting: string },
): ToolResult {
  const metadata: Record<string, unknown> = {
    ...(result.metadata ?? {}),
    effectiveTimeoutSeconds: resolution.effectiveTimeoutSeconds,
    requestedTimeoutSeconds: resolution.requestedTimeoutSeconds,
    timeoutClamped: resolution.clamped,
  };
  const clamp = describeTimeoutClamp(resolution, settings);
  if (clamp === undefined) {
    return { ...result, metadata };
  }
  const clampNotice = `\n\n${clamp}`;
  const llmContent =
    typeof result.llmContent === 'string'
      ? `${result.llmContent}${clampNotice}`
      : result.llmContent;
  const returnDisplay =
    typeof result.returnDisplay === 'string'
      ? `${result.returnDisplay}${clampNotice}`
      : result.returnDisplay;
  return { ...result, metadata, llmContent, returnDisplay };
}
