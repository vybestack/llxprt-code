/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  ErroredToolCall,
  ToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import { createErrorResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import type { PreparedToolExecution } from './tool-executor.js';
import type { ToolDispatcher } from './tool-dispatcher.js';
import type { ConfirmationCoordinator } from './confirmation-coordinator.js';
import { setToolContext } from './utils.js';

interface RebuildToolCallArguments {
  readonly calls: ToolCall[];
  readonly targetCallId: string;
  readonly args: unknown;
  readonly config: Config;
  readonly toolContextInteractiveMode: boolean;
  readonly toolDispatcher: ToolDispatcher;
  readonly confirmationCoordinator: ConfirmationCoordinator;
  readonly preparedExecutions: Map<string, PreparedToolExecution>;
}

function rebuildToolCallArguments(
  options: RebuildToolCallArguments,
): ToolCall[] {
  const {
    calls,
    targetCallId,
    args,
    config,
    toolContextInteractiveMode,
    toolDispatcher,
    confirmationCoordinator,
    preparedExecutions,
  } = options;
  return calls.map((call) => {
    if (call.request.callId !== targetCallId || call.status === 'error') {
      return call;
    }

    setToolContext(
      call.tool,
      config.getSessionId(),
      call.request.agentId ?? DEFAULT_AGENT_ID,
      toolContextInteractiveMode,
    );

    const invocationOrError = toolDispatcher.buildInvocation(
      call.tool,
      args as Record<string, unknown>,
    );
    if (invocationOrError instanceof Error) {
      const response = createErrorResponse(
        call.request,
        invocationOrError,
        ToolErrorType.INVALID_TOOL_PARAMS,
      );
      return {
        request: { ...call.request, args: args as Record<string, unknown> },
        status: 'error',
        tool: call.tool,
        invocation: call.invocation,
        response,
      } as ErroredToolCall;
    }

    const updatedRequest = {
      ...call.request,
      args: structuredClone(args as Record<string, unknown>),
    };
    const editedCall = {
      status: 'validating' as const,
      request: updatedRequest,
      tool: call.tool,
      invocation: invocationOrError,
    };
    if (confirmationCoordinator.isEditedInvocationDenied(editedCall)) {
      return {
        ...call,
        request: updatedRequest,
        status: 'error',
        response: createErrorResponse(
          updatedRequest,
          new Error('Policy denied the approval-edited tool arguments.'),
          ToolErrorType.POLICY_VIOLATION,
        ),
      } as ErroredToolCall;
    }

    const prepared = preparedExecutions.get(targetCallId);
    if (prepared === undefined)
      throw new Error(
        `Tool call ${targetCallId} was edited before it was prepared.`,
      );
    preparedExecutions.set(targetCallId, {
      ...prepared,
      invocation: invocationOrError,
      effectiveArgs: structuredClone(updatedRequest.args),
    });
    return {
      ...call,
      request: updatedRequest,
      invocation: invocationOrError,
    };
  });
}

export { rebuildToolCallArguments };
