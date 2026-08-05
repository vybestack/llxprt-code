/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildSubagentExcludedToolNames,
  buildToolGovernance,
  canonicalizeToolName as canonicalizeSharedToolName,
  getToolNameCandidates,
  INVALID_TOOL_NAME,
  isSubagentExcludedToolName,
  isToolBlocked,
  ToolErrorType,
  type SubagentConfig as ToolsSubagentConfig,
  type SubagentRequest,
  type SubagentResult,
  type ToolGovernance,
} from '@vybestack/llxprt-code-tools';
import {
  resolveTimeout as sharedResolveTimeout,
  describeTimeoutClamp,
  describeTimeoutTermination,
  requireEffectiveTimeoutSeconds,
  type TimeoutResolution,
} from '@vybestack/llxprt-code-tools/utils/timeoutResolution.js';
import type { Config } from '../config/config.js';
import type { SubagentConfig as CoreSubagentConfig } from '../config/types.js';
import { ContextState, type OutputObject } from '../core/subagentTypes.js';

// Re-exported so CoreSubagentServiceAdapter can reference the canonical
// TimeoutResolution type without a separate import (Issue #3031).
export type { TimeoutResolution } from '@vybestack/llxprt-code-tools/utils/timeoutResolution.js';

export {
  buildSubagentExcludedToolNames,
  buildToolGovernance,
  getToolNameCandidates,
  isSubagentExcludedToolName,
  isToolBlocked,
  type ToolGovernance,
};

export function canonicalizeToolName(rawName: string): string {
  const canonicalName = canonicalizeSharedToolName(rawName);
  return canonicalName === INVALID_TOOL_NAME ? '' : canonicalName;
}

export const DEFAULT_AGENT_ID = 'main';

export function toToolsSubagentConfig(
  config: CoreSubagentConfig,
): ToolsSubagentConfig {
  return {
    name: config.name,
    instructions: config.systemPrompt,
    systemPrompt: config.systemPrompt,
    profile: config.profile,
    updatedAt: config.updatedAt,
  };
}

export function buildContextState(
  request: SubagentRequest,
  config?: Config,
): ContextState {
  const context = new ContextState();
  context.set('task_goal', request.prompt);
  context.set('task_name', request.name);

  const sessionId = config?.getSessionId();
  if (sessionId !== undefined && sessionId.length > 0) {
    context.set('sessionId', sessionId);
  }

  for (const [key, value] of Object.entries(request.context ?? {})) {
    context.set(key, value);
  }

  context.set('task_behaviour_prompts', [
    request.prompt,
    ...(request.behaviourPrompts ?? request.behaviorPrompts ?? []),
  ]);
  return context;
}

export function stringifySubagentOutput(output: OutputObject): string {
  if (output.final_message && output.final_message.trim().length > 0) {
    return output.final_message;
  }
  if (Object.keys(output.emitted_vars).length > 0) {
    return JSON.stringify(output.emitted_vars);
  }
  return `Subagent terminated with reason ${output.terminate_reason}.`;
}

export function createErrorResult(
  error: unknown,
  fallbackMessage: string,
  agentId?: string,
): SubagentResult {
  const detail = error instanceof Error && error.message ? error.message : null;
  const displayMessage = detail
    ? `${fallbackMessage}
Details: ${detail}`
    : fallbackMessage;
  const message = detail ?? fallbackMessage;
  return {
    output: displayMessage,
    success: false,
    error: message,
    llmContent: displayMessage,
    returnDisplay: displayMessage,
    metadata: agentId
      ? {
          agentId,
          error: message,
        }
      : undefined,
    errorType: ToolErrorType.UNHANDLED_EXCEPTION,
  };
}

export function createCancelledResult(
  message: string,
  agentId?: string,
  output?: OutputObject,
): SubagentResult {
  return {
    output: message,
    success: false,
    error: message,
    llmContent: message,
    returnDisplay: message,
    metadata: {
      agentId: agentId ?? DEFAULT_AGENT_ID,
      terminateReason: output?.terminate_reason,
      emittedVars: output?.emitted_vars ?? {},
      ...(output?.final_message ? { finalMessage: output.final_message } : {}),
      cancelled: true,
    },
    errorType: ToolErrorType.EXECUTION_FAILED,
  };
}

export function formatSuccessDisplay(
  subagentName: string,
  agentId: string,
  output: OutputObject,
): string {
  const emittedVars = Object.entries(output.emitted_vars);
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

export function formatSuccessContent(
  agentId: string,
  output: OutputObject,
): string {
  const payload: Record<string, unknown> = {
    agent_id: agentId,
    terminate_reason: output.terminate_reason,
    emitted_vars: output.emitted_vars,
  };

  if (output.final_message !== undefined) {
    payload.final_message = output.final_message;
  }

  return JSON.stringify(payload, null, 2);
}

/**
 * Normalizes line endings in a streaming text fragment without forcing a
 * trailing newline. See taskAsyncExecution.ts for rationale.
 *
 * Preserved for backward compatibility. Prefer `toLosslessTextDelta` for an
 * isolated single delta (stateless CR/CRLF→LF), or `createStreamNormalizer`
 * for a stream spanning chunk boundaries (correctly joins a CRLF pair split
 * across consecutive deltas and flushes a trailing lone CR on close).
 */
export function normalizeSubagentStreamingText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Shipped default / maximum for subagent task timeouts (Issue #3031). */
export const DEFAULT_TASK_TIMEOUT_SECONDS = 900;
export const MAX_TASK_TIMEOUT_SECONDS = 1800;

/** Setting names surfaced to the model and to clamp/timeout notices. */
export const TASK_TIMEOUT_DEFAULT_SETTING = 'task-default-timeout-seconds';
export const TASK_TIMEOUT_MAX_SETTING = 'task-max-timeout-seconds';

/** Resolves the full timeout outcome (effective seconds + clamping flag). */
export function resolveTimeoutResolution(
  requestedTimeoutSeconds: number | undefined,
  defaultTimeoutSeconds: number,
  maxTimeoutSeconds: number,
): TimeoutResolution {
  return sharedResolveTimeout(
    requestedTimeoutSeconds,
    defaultTimeoutSeconds,
    maxTimeoutSeconds,
  );
}

/**
 * Attaches the resolved timeout metadata (`effectiveTimeoutSeconds`,
 * `requestedTimeoutSeconds`, `timeoutClamped`) to a `SubagentResult`, and —
 * when the requested/default value was reduced to the ceiling — appends the
 * clamp notice to the model-facing content (Issue #3031).
 */
export function attachTimeoutMetadataToResult(
  result: SubagentResult,
  resolution: TimeoutResolution,
): SubagentResult {
  const metadata: Record<string, unknown> = {
    ...(result.metadata ?? {}),
    effectiveTimeoutSeconds: resolution.effectiveTimeoutSeconds,
    requestedTimeoutSeconds: resolution.requestedTimeoutSeconds,
    timeoutClamped: resolution.clamped,
  };
  const clamp = describeTimeoutClamp(resolution, {
    defaultSetting: TASK_TIMEOUT_DEFAULT_SETTING,
    maxSetting: TASK_TIMEOUT_MAX_SETTING,
  });
  if (clamp === undefined) {
    return { ...result, metadata };
  }
  const suffix = `

${clamp}`;
  return {
    ...result,
    metadata,
    ...(result.llmContent !== undefined
      ? { llmContent: `${result.llmContent}${suffix}` }
      : {}),
    ...(result.returnDisplay !== undefined
      ? { returnDisplay: `${result.returnDisplay}${suffix}` }
      : {}),
    output: `${result.output}${suffix}`,
  };
}

/** Builds the legible timeout-termination message (shared wording). */
export function describeTaskTimeout(resolution: TimeoutResolution): string {
  return describeTimeoutTermination(
    requireEffectiveTimeoutSeconds(resolution),
    {
      defaultSetting: TASK_TIMEOUT_DEFAULT_SETTING,
      maxSetting: TASK_TIMEOUT_MAX_SETTING,
    },
  );
}

/**
 * Builds the TIMEOUT `SubagentResult` — a legible message naming the effective
 * bound and the settings that raise it, with `errorType: TIMEOUT` (Issue #3031).
 * Extracted to the helpers module so the adapter stays within its line budget.
 */
export function createTimeoutSubagentResult(
  resolution: TimeoutResolution,
  output?: OutputObject,
  agentId?: string,
): SubagentResult {
  const message = describeTaskTimeout(resolution);
  return {
    output: message,
    success: false,
    error: message,
    llmContent: message,
    returnDisplay: message,
    metadata: {
      agentId,
      terminateReason: output?.terminate_reason ?? 'TIMEOUT',
      emittedVars: output?.emitted_vars ?? {},
      ...(output?.final_message ? { finalMessage: output.final_message } : {}),
      timedOut: true,
      effectiveTimeoutSeconds: resolution.effectiveTimeoutSeconds,
    },
    errorType: ToolErrorType.TIMEOUT,
  };
}

export const buildExcludedToolNames = buildSubagentExcludedToolNames;

/** Timeout setup carrying the full resolution (Issue #3031). */
export interface CoreTimeoutSetup {
  readonly timeoutMs?: number;
  readonly resolution: TimeoutResolution;
  readonly timeoutController: AbortController;
  readonly timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Fails a running async task with a legible timeout reason when the timeout
 * controller has aborted. Extracted to eliminate duplication between the
 * try and catch branches of background execution (Issue #3031).
 */
export function failTaskIfTimeout(
  asyncTaskManager: {
    getTask: (id: string) => { status: string } | undefined;
    failTask: (id: string, reason: string) => void;
  },
  agentId: string,
  resolution: TimeoutResolution,
): void {
  if (asyncTaskManager.getTask(agentId)?.status === 'running') {
    asyncTaskManager.failTask(agentId, describeTaskTimeout(resolution));
  }
}

/** "Async mode not configured" error result (Issue #3031). */
export function createAsyncNotConfiguredResult(): SubagentResult {
  return {
    output: 'Async mode requires AsyncTaskManager to be configured.',
    success: false,
    error: 'AsyncTaskManager not configured',
    llmContent: 'Async mode requires AsyncTaskManager to be configured.',
    returnDisplay: 'Error: Async mode not available.',
    errorType: ToolErrorType.EXECUTION_FAILED,
  };
}

/** "No async slot available" error result (Issue #3031). */
export function createSlotFullResult(asyncTaskManager: {
  canLaunchAsync: () => { allowed: boolean; reason?: string };
}): SubagentResult {
  const canLaunch = asyncTaskManager.canLaunchAsync();
  const baseReason = canLaunch.reason ?? 'Async task limit reached';
  const guidance =
    'You can: (1) wait for running async tasks to complete using check_async_tasks, ' +
    '(2) launch this subagent synchronously (without async: true), or ' +
    '(3) try again later when a slot is available.';
  return {
    output: `${baseReason}. ${guidance}`,
    success: false,
    error: baseReason,
    llmContent: `${baseReason}. ${guidance}`,
    returnDisplay: baseReason,
    errorType: ToolErrorType.EXECUTION_FAILED,
  };
}

function isAbortErrorLike(error: unknown): boolean {
  return (
    error !== null &&
    error !== undefined &&
    typeof error === 'object' &&
    (error as { name?: string }).name === 'AbortError'
  );
}

/**
 * Cleans up after a failed async launch: cancels the reservation, clears the
 * timeout timer, disposes any partially-created launch result, and — when the
 * timeout controller aborted — returns a legible TIMEOUT result instead of a
 * generic error or cancellation (Issue #3031).
 */
export async function handleAsyncLaunchFailure(
  error: unknown,
  timeout: CoreTimeoutSetup | undefined,
  launchResult: { dispose: () => Promise<void> } | undefined,
  bookingId: string,
  asyncTaskManager: { cancelReservation: (id: string) => void },
  parentSignal: AbortSignal | undefined,
): Promise<SubagentResult> {
  asyncTaskManager.cancelReservation(bookingId);
  if (timeout?.timeoutId) {
    clearTimeout(timeout.timeoutId);
  }
  if (launchResult !== undefined) {
    try {
      await launchResult.dispose();
    } catch {
      // Disposal errors are non-actionable on a failure path.
    }
  }
  if (timeout?.timeoutController.signal.aborted === true) {
    return attachTimeoutMetadataToResult(
      createTimeoutSubagentResult(timeout.resolution),
      timeout.resolution,
    );
  }
  const aborted = parentSignal?.aborted === true || isAbortErrorLike(error);
  if (aborted) {
    return createCancelledResult('Task execution aborted before completion.');
  }
  return createErrorResult(error, 'Subagent execution failed.');
}
export const isExcludedToolName = isSubagentExcludedToolName;
