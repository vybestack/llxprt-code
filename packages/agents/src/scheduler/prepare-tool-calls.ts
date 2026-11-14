/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { ToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { ToolCallResponseInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import { createErrorResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import {
  ToolArgumentValidationError,
  ToolHookStopError,
  type PreparedToolExecution,
  type ToolExecutor,
} from './tool-executor.js';

export interface PrepareToolCallsOptions {
  readonly calls: readonly ToolCall[];
  readonly toolExecutor: ToolExecutor;
  readonly signal: AbortSignal;
  readonly hookOwner?: HookExecutionOwner;
  readonly preparedExecutions: Map<string, PreparedToolExecution>;
  readonly setError: (callId: string, response: ToolCallResponseInfo) => void;
}

/**
 * Prepares the effective invocation of every validating call before policy
 * evaluation (issue #4084): BeforeTool runs once here, hook-modified input is
 * rebuilt and validated, and the call that policy evaluates carries exactly
 * the arguments that will execute. A failed preparation is a tool error, never
 * a fallback to the original invocation. Returns the calls to evaluate,
 * replacing each prepared call with its effective arguments and invocation.
 *
 * Without a hook owner preparation is synchronous, which keeps ALLOW calls
 * reaching 'scheduled' in the same microtask as schedule().
 */
export function prepareToolCalls(
  options: PrepareToolCallsOptions,
): ToolCall[] | Promise<ToolCall[]> {
  if (options.hookOwner === undefined) {
    return options.calls.map((call) => {
      if (call.status !== 'validating') return call;
      return applyPreparation(
        options,
        call,
        options.toolExecutor.prepareDirect(call),
      );
    });
  }
  return prepareWithHooks(options, options.hookOwner);
}

async function prepareWithHooks(
  options: PrepareToolCallsOptions,
  hookOwner: HookExecutionOwner,
): Promise<ToolCall[]> {
  const prepared: ToolCall[] = [];
  for (const call of options.calls) {
    if (call.status !== 'validating') {
      prepared.push(call);
      continue;
    }
    try {
      const execution = await options.toolExecutor.prepareWithHook(
        call,
        options.signal,
        hookOwner,
      );
      prepared.push(applyPreparation(options, call, execution));
    } catch (error) {
      failPreparation(options, call, error);
    }
  }
  return prepared;
}

function applyPreparation(
  options: PrepareToolCallsOptions,
  call: ToolCall,
  execution: PreparedToolExecution,
): ToolCall {
  options.preparedExecutions.set(call.request.callId, execution);
  return {
    ...call,
    request: { ...call.request, args: execution.effectiveArgs },
    invocation: execution.invocation,
  } as ToolCall;
}

function failPreparation(
  options: PrepareToolCallsOptions,
  call: ToolCall,
  error: unknown,
): void {
  options.setError(
    call.request.callId,
    createErrorResponse(
      call.request,
      error instanceof Error ? error : new Error(String(error)),
      preparationErrorType(error),
    ),
  );
}

function preparationErrorType(error: unknown): ToolErrorType {
  if (error instanceof ToolArgumentValidationError)
    return ToolErrorType.INVALID_TOOL_PARAMS;
  if (error instanceof ToolHookStopError) return ToolErrorType.STOP_EXECUTION;
  return ToolErrorType.UNHANDLED_EXCEPTION;
}
