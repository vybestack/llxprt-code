import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type {
  ToolExecutionPolicy,
  ToolGovernance,
} from '@vybestack/llxprt-code-tools';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import {
  type ToolCallRequestInfo,
  DEFAULT_AGENT_ID,
} from '@vybestack/llxprt-code-core/core/turn.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import type { SchedulerCallbacks } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type {
  SessionSchedulerOwner,
  SchedulerLease,
} from '../session/sessionSchedulerOwner.js';
import { type Config } from '@vybestack/llxprt-code-core/config/config.js';
import { toolFailureMarker } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { type CompletedToolCall } from './coreToolScheduler.js';
import { canonicalizeToolName } from './toolGovernance.js';

/**
 * Configuration subset required for non-interactive tool execution.
 */
export type ToolExecutionConfig = Pick<
  Config,
  'getExcludeTools' | 'getSessionId' | 'getTelemetryLogPromptsEnabled'
> &
  Partial<Pick<Config, 'getAllowedTools' | 'getApprovalMode'>> & {
    telemetry: RootTelemetry;
    readApprovalMode?: () => ApprovalMode;
    readExecutionPolicy(): ToolExecutionPolicy;
    readGovernance(): ToolGovernance;
    getToolRegistry(): ToolSelection | undefined;
  };

async function createScheduler(
  createOwner: (callbacks: SchedulerCallbacks) => SessionSchedulerOwner,
  completionResolver: ((calls: CompletedToolCall[]) => void) | null,
): Promise<SchedulerLease> {
  const owner = createOwner({
    getPreferredEditor: () => undefined,
    onEditorClose: () => {},
    onAllToolCallsComplete: async (calls) => {
      completionResolver?.(calls);
    },
  });
  const lease = owner.acquire();
  await lease.ready;
  return lease;
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
  createOwner: (callbacks: SchedulerCallbacks) => SessionSchedulerOwner,
  toolCallRequest: ToolCallRequestInfo,
  abortSignal?: AbortSignal,
  hookOwner?: HookExecutionOwner,
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

  const scheduler = await createScheduler(createOwner, completionResolver);

  try {
    const effectiveSignal = internalAbortController.signal;
    await scheduler.schedule([toolCallRequest], effectiveSignal, hookOwner);

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
    await scheduler.release();
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
