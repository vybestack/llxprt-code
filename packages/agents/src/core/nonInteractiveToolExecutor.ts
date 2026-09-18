/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolCallRequestInfo,
  DEFAULT_AGENT_ID,
} from '@vybestack/llxprt-code-core/core/turn.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { type Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SchedulerHandle } from '@vybestack/llxprt-code-core/session/sessionExecutionServices.js';
import { toolFailureMarker } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { type CompletedToolCall } from './coreToolScheduler.js';
import { canonicalizeToolName } from './toolGovernance.js';

/**
 * Configuration subset required for non-interactive tool execution.
 * Acquires and releases the session scheduler registry through
 * getOrCreateScheduler/disposeScheduler.
 */
export type ToolExecutionConfig = Pick<
  Config,
  | 'getToolRegistry'
  | 'getEphemeralSettings'
  | 'getEphemeralSetting'
  | 'getExcludeTools'
  | 'getSessionId'
  | 'getTelemetryLogPromptsEnabled'
  | 'getOrCreateScheduler'
  | 'disposeScheduler'
> &
  Partial<Pick<Config, 'getAllowedTools' | 'getApprovalMode'>>;

/**
 * Executes a single tool call non-interactively by acquiring the shared
 * CoreToolScheduler from the session scheduler registry.
 *
 * This wrapper:
 * 1. Acquires the registry scheduler (via config.getOrCreateScheduler) with
 *    interactiveMode: false under the caller-supplied owner object and the
 *    'subagent' purpose
 * 2. Schedules the tool call
 * 3. Returns the completed result
 *
 * Non-interactive mode means:
 * - The scheduler uses toolContextInteractiveMode: false so tools know they're non-interactive
 * - No live output updates are provided
 *
 * Benefits of sharing one scheduler per owner:
 * - Scheduler is acquired from the per-Config registry per call and disposed when the acquisition count reaches zero, so no scheduler or subscription outlives its users
 * - Proper refcount-based lifecycle management
 * - Consistent tool governance path with interactive mode
 *
 * Note: Emoji filtering is handled by the individual tools (edit.ts, write-file.ts)
 * so it is not duplicated here.
 */
async function createScheduler(
  config: ToolExecutionConfig,
  owner: object,
  completionResolver: ((calls: CompletedToolCall[]) => void) | null,
  dependencies?: { messageBus?: MessageBus },
): Promise<SchedulerHandle> {
  return config.getOrCreateScheduler(
    owner,
    'subagent',
    {
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (completedToolCalls) => {
        completionResolver?.(completedToolCalls);
      },
    },
    { interactiveMode: false },
    dependencies,
  );
}
function isBlockedByHookRestriction(request: ToolCallRequestInfo): boolean {
  const allowedTools = request.hookRestrictedAllowedTools;
  if (allowedTools === undefined) {
    return false;
  }
  const allowed = new Set(allowedTools.map(canonicalizeToolName));
  return !allowed.has(canonicalizeToolName(request.name));
}

export async function executeToolCall(
  config: ToolExecutionConfig,
  toolCallRequest: ToolCallRequestInfo,
  abortSignal?: AbortSignal,
  dependencies?: {
    messageBus?: MessageBus;
    /**
     * Registry owner for the scheduler acquisition: the object identifying
     * the executing context (e.g. the subagent processing context). Identity,
     * not any label string, keys the entry, and the same object must be
     * supplied for every call of one execution so acquire and release
     * balance.
     */
    owner: object;
  },
): Promise<CompletedToolCall> {
  const startTime = Date.now();

  if (isBlockedByHookRestriction(toolCallRequest)) {
    return Promise.reject(
      new Error(
        `Tool "${toolCallRequest.name}" is disabled by hook restrictions.`,
      ),
    );
  }

  const agentId = toolCallRequest.agentId ?? DEFAULT_AGENT_ID;
  toolCallRequest.agentId = agentId;

  const internalAbortController = new AbortController();
  let parentAbortHandler: (() => void) | null = null;
  if (abortSignal) {
    if (abortSignal.aborted) {
      internalAbortController.abort();
    } else {
      parentAbortHandler = (): void => internalAbortController.abort();
      abortSignal.addEventListener('abort', parentAbortHandler, { once: true });
    }
  }

  let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
  const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
    completionResolver = resolve;
  });

  // Fail fast: the owner is the registry key and only the caller knows the
  // executing context; there is no valid derivation from the config alone.
  const owner = dependencies?.owner;
  if (owner === undefined) {
    throw new Error(
      'executeToolCall requires an owner object identifying the executing context.',
    );
  }

  const scheduler = await createScheduler(
    config,
    owner,
    completionResolver,
    dependencies,
  );

  try {
    const effectiveSignal = internalAbortController.signal;
    await scheduler.schedule([toolCallRequest], effectiveSignal);

    const completedCalls = await completionPromise;
    if (completedCalls.length !== 1) {
      throw new Error('Non-interactive executor expects exactly one tool call');
    }

    const completed = completedCalls[0];

    if (
      completed.response.agentId === undefined ||
      completed.response.agentId === ''
    ) {
      completed.response.agentId = agentId;
    }

    return completed;
  } catch (e) {
    return createErrorCompletedToolCall(
      toolCallRequest,
      e instanceof Error ? e : new Error(String(e)),
      ToolErrorType.UNHANDLED_EXCEPTION,
      Date.now() - startTime,
    );
  } finally {
    if (abortSignal && parentAbortHandler) {
      abortSignal.removeEventListener('abort', parentAbortHandler);
    }
    if (internalAbortController.signal.aborted) {
      scheduler.cancelAll();
    }
    config.disposeScheduler(owner, 'subagent');
  }
}

function createErrorCompletedToolCall(
  request: ToolCallRequestInfo,
  error: Error,
  errorType: ToolErrorType,
  durationMs: number,
): CompletedToolCall {
  return {
    status: 'error',
    request,
    response: {
      callId: request.callId,
      agentId: request.agentId ?? DEFAULT_AGENT_ID,
      error,
      errorType,
      resultDisplay: error.message,
      responseParts: [
        // Only tool_response — the tool_call is already recorded in
        // history from the model's assistant message (Issue #244).
        {
          type: 'tool_response',
          callId: request.callId,
          toolName: request.name,
          result: { error: error.message },
          // Issue #3063: mark the failure on the top-level field so the
          // provider layer reports status "error" (derived by truthiness).
          error: toolFailureMarker(error.message),
        },
      ],
    },
    durationMs,
  };
}
