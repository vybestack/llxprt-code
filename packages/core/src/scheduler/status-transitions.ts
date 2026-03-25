/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure transition builder functions for ToolCall state machine.
 * Extracted from CoreToolScheduler.setStatusInternal to keep functions under 80 lines.
 */

import type {
  ToolCall,
  ValidatingToolCall,
  ScheduledToolCall,
  ExecutingToolCall,
  SuccessfulToolCall,
  ErroredToolCall,
  CancelledToolCall,
  WaitingToolCall,
  Status,
} from './types.js';
import type {
  ToolCallResponseInfo,
  ToolCallConfirmationDetails,
  ToolResultDisplay,
} from '../index.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';
import { ToolConfirmationOutcome } from '../index.js';

/**
 * Common context extracted from a non-terminal tool call for building transitions.
 */
interface TransitionContext {
  request: ToolCall['request'];
  tool: Exclude<ToolCall, ErroredToolCall>['tool'];
  invocation: Exclude<ToolCall, ErroredToolCall | WaitingToolCall>['invocation'];
  startTime?: number;
  outcome?: ToolCall['outcome'];
}

function getTransitionContext(call: ToolCall): TransitionContext | undefined {
  // Terminal states cannot transition further
  if (
    call.status === 'success' ||
    call.status === 'error' ||
    call.status === 'cancelled'
  ) {
    return undefined;
  }
  return {
    request: call.request,
    tool: call.tool,
    invocation: call.invocation,
    startTime: call.startTime,
    outcome: call.outcome,
  };
}

function computeDuration(startTime?: number): number | undefined {
  return startTime ? Date.now() - startTime : undefined;
}

function ensureAgentId(response: ToolCallResponseInfo, request: ToolCall['request']): ToolCallResponseInfo {
  const copy = { ...response };
  if (!copy.agentId) {
    copy.agentId = request.agentId ?? DEFAULT_AGENT_ID;
  }
  return copy;
}

export function buildSuccessTransition(
  ctx: TransitionContext,
  response: ToolCallResponseInfo,
): SuccessfulToolCall {
  return {
    request: ctx.request,
    tool: ctx.tool,
    invocation: ctx.invocation,
    status: 'success',
    response: ensureAgentId(response, ctx.request),
    durationMs: computeDuration(ctx.startTime),
    outcome: ctx.outcome,
  } as SuccessfulToolCall;
}

export function buildErrorTransition(
  ctx: TransitionContext,
  response: ToolCallResponseInfo,
): ErroredToolCall {
  return {
    request: ctx.request,
    status: 'error',
    tool: ctx.tool,
    response: ensureAgentId(response, ctx.request),
    durationMs: computeDuration(ctx.startTime),
    outcome: ctx.outcome,
  } as ErroredToolCall;
}

export function buildCancelledTransition(
  ctx: TransitionContext,
  reason: string,
  currentStatus: Status,
  currentCall: ToolCall,
): CancelledToolCall {
  // Preserve diff for cancelled edit operations
  let resultDisplay: ToolResultDisplay | undefined = undefined;
  if (currentStatus === 'awaiting_approval') {
    const waitingCall = currentCall as WaitingToolCall;
    if (waitingCall.confirmationDetails.type === 'edit') {
      resultDisplay = {
        fileDiff: waitingCall.confirmationDetails.fileDiff,
        fileName: waitingCall.confirmationDetails.fileName,
        originalContent: waitingCall.confirmationDetails.originalContent,
        newContent: waitingCall.confirmationDetails.newContent,
        filePath: waitingCall.confirmationDetails.filePath,
      };
    }
  }

  return {
    request: ctx.request,
    tool: ctx.tool,
    invocation: ctx.invocation,
    status: 'cancelled',
    response: {
      callId: ctx.request.callId,
      responseParts: [
        {
          functionResponse: {
            id: ctx.request.callId,
            name: ctx.request.name,
            response: {
              error: `[Operation Cancelled] Reason: ${reason}`,
            },
          },
        },
      ],
      resultDisplay,
      error: undefined,
      errorType: undefined,
      agentId: ctx.request.agentId ?? DEFAULT_AGENT_ID,
    },
    durationMs: computeDuration(ctx.startTime),
    outcome: ctx.outcome,
  } as CancelledToolCall;
}

export function buildAwaitingApprovalTransition(
  ctx: TransitionContext,
  confirmationDetails: ToolCallConfirmationDetails,
): WaitingToolCall {
  return {
    request: ctx.request,
    tool: ctx.tool,
    status: 'awaiting_approval',
    confirmationDetails,
    startTime: ctx.startTime,
    outcome: ctx.outcome,
    invocation: ctx.invocation,
  } as WaitingToolCall;
}

export function buildSimpleTransition(
  ctx: TransitionContext,
  status: 'scheduled' | 'validating' | 'executing',
): ScheduledToolCall | ValidatingToolCall | ExecutingToolCall {
  return {
    request: ctx.request,
    tool: ctx.tool,
    status,
    startTime: ctx.startTime,
    outcome: ctx.outcome,
    invocation: ctx.invocation,
  } as ScheduledToolCall | ValidatingToolCall | ExecutingToolCall;
}

/**
 * Build a cancelled tool call from cancelAll() — simpler than the setStatusInternal
 * path because we don't need to check for edit confirmations or use a reason string.
 */
export function buildCancelAllEntry(
  call: ValidatingToolCall | ScheduledToolCall | ExecutingToolCall | WaitingToolCall,
): CancelledToolCall {
  return {
    status: 'cancelled',
    request: call.request,
    response: {
      callId: call.request.callId,
      responseParts: [
        {
          functionResponse: {
            id: call.request.callId,
            name: call.request.name,
            response: {
              error: 'Tool call cancelled by user.',
            },
          },
        },
      ],
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
      agentId: call.request.agentId ?? DEFAULT_AGENT_ID,
    },
    tool: call.tool,
    invocation: call.invocation,
    durationMs: call.startTime ? Date.now() - call.startTime : undefined,
    outcome: ToolConfirmationOutcome.Cancel,
  };
}

/**
 * Apply a status transition to a single tool call.
 * Returns the original call if it's in a terminal state or doesn't match the target callId.
 */
export function applyTransition(
  currentCall: ToolCall,
  targetCallId: string,
  newStatus: Status,
  auxiliaryData?: unknown,
): ToolCall {
  if (
    currentCall.request.callId !== targetCallId ||
    currentCall.status === 'success' ||
    currentCall.status === 'error' ||
    currentCall.status === 'cancelled'
  ) {
    return currentCall;
  }

  const ctx = getTransitionContext(currentCall);
  if (!ctx) return currentCall;

  switch (newStatus) {
    case 'success':
      return buildSuccessTransition(ctx, auxiliaryData as ToolCallResponseInfo);
    case 'error':
      return buildErrorTransition(ctx, auxiliaryData as ToolCallResponseInfo);
    case 'cancelled':
      return buildCancelledTransition(
        ctx,
        auxiliaryData as string,
        currentCall.status,
        currentCall,
      );
    case 'awaiting_approval':
      return buildAwaitingApprovalTransition(
        ctx,
        auxiliaryData as ToolCallConfirmationDetails,
      );
    case 'scheduled':
    case 'validating':
    case 'executing':
      return buildSimpleTransition(ctx, newStatus);
    default: {
      const exhaustiveCheck: never = newStatus;
      return exhaustiveCheck;
    }
  }
}
