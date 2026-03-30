/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { FunctionCall } from '@google/genai';
import type { AnyToolInvocation } from '../tools/tools.js';
import { BaseToolInvocation } from '../tools/tools.js';
import type {
  ToolCallRequestInfo,
  ToolCallResponseInfo,
} from '../core/turn.js';
import type { PolicyContext } from '../scheduler/types.js';
import type { PolicyDecision } from './types.js';
import type { PolicyEngine } from './policy-engine.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import { ToolErrorType } from '../index.js';
import { createErrorResponse } from '../utils/generateContentResponseUtilities.js';

/**
 * Extract policy context from a tool invocation.
 */
export function getPolicyContextFromInvocation(
  invocation: AnyToolInvocation,
  request: ToolCallRequestInfo,
): PolicyContext {
  if (invocation instanceof BaseToolInvocation) {
    const context = invocation.getPolicyContext();
    if (context.toolName === 'unknown' || !context.toolName) {
      return {
        ...context,
        toolName: request.name,
      };
    }
    return context;
  }
  return {
    toolName: request.name,
    args: request.args,
  };
}

/**
 * Evaluate policy decision for a tool invocation.
 */
export function evaluatePolicyDecision(
  invocation: AnyToolInvocation,
  request: ToolCallRequestInfo,
  policyEngine: PolicyEngine,
): { decision: PolicyDecision; context: PolicyContext } {
  const context = getPolicyContextFromInvocation(invocation, request);
  const decision = policyEngine.evaluate(
    context.toolName,
    context.args,
    context.serverName,
  );
  return { decision, context };
}

/**
 * Handle policy denial by setting error status and publishing rejection event.
 */
export function handlePolicyDenial(
  request: ToolCallRequestInfo,
  context: PolicyContext,
  setStatusFn: (
    callId: string,
    status: 'error',
    response: ToolCallResponseInfo,
  ) => void,
  messageBus: MessageBus,
): void {
  const message = `Policy denied execution of tool "${context.toolName}".`;
  const error = new Error(message);
  const response = createErrorResponse(
    request,
    error,
    ToolErrorType.POLICY_VIOLATION,
  );

  setStatusFn(request.callId, 'error', response);

  const toolCall: FunctionCall = {
    name: context.toolName,
    args: context.args,
  };
  messageBus.publish({
    type: MessageBusType.TOOL_POLICY_REJECTION,
    correlationId: randomUUID(),
    reason: message,
    serverName: context.serverName,
    toolCall,
  });
}

/**
 * Publish a tool confirmation request.
 */
export function publishConfirmationRequest(
  correlationId: string,
  context: PolicyContext,
  messageBus: MessageBus,
): void {
  const toolCall: FunctionCall = {
    name: context.toolName,
    args: context.args,
  };
  messageBus.publish({
    type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
    serverName: context.serverName,
    toolCall,
    correlationId,
  });
}
