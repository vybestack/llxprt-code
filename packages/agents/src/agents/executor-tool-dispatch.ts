/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Tool-dispatch helpers extracted from the agent executor.
 *
 * These pure functions handle the mechanics of processing model-requested
 * function calls: dispatching each call, handling the special
 * `complete_task` tool, validating output against the agent's output schema,
 * and assembling the response parts for the next loop iteration.
 *
 * Extracted into a sibling module so the main executor file stays within the
 * project line budget while preserving exact behavior.
 */

import { Type } from '@google/genai';
import type { Content, Part, FunctionCall } from '@google/genai';
import { type z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Schema, FunctionDeclaration } from '@google/genai';
import { executeToolCall } from '../core/nonInteractiveToolExecutor.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { type ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  getHookRestrictedAllowedToolsForFunctionCall,
  isHookRestrictedToolCall,
} from '../core/hookToolRestrictions.js';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import { TASK_COMPLETE_TOOL_NAME } from './recovery.js';
import type { AgentDefinition, SubagentActivityEventType } from './types.js';

/** Result of executing one or more tool calls. */
export interface ToolExecutionResult {
  responseParts: Part[];
  partialResult: string | null;
}

/** Final result of processing all function calls in a turn. */
export interface FunctionCallProcessingResult {
  nextMessage: Content;
  submittedOutput: string | null;
  taskCompleted: boolean;
  partialResult: string | null;
}

/** Callback for emitting activity events during tool execution. */
export type EmitActivityFn = (
  type: SubagentActivityEventType,
  data: Record<string, unknown>,
) => void;

/** Output config type derived from an AgentDefinition. */
type OutputConfig = NonNullable<AgentDefinition<z.ZodTypeAny>['outputConfig']>;

/**
 * Builds the `complete_task` tool function declaration, optionally configured
 * with the agent's output schema.
 */
export function buildCompleteTaskDeclaration(
  outputConfig: OutputConfig | undefined,
): FunctionDeclaration {
  const completeTool: FunctionDeclaration = {
    name: TASK_COMPLETE_TOOL_NAME,
    description: outputConfig
      ? 'Call this tool to submit your final answer and complete the task. This is the ONLY way to finish.'
      : 'Call this tool to signal that you have completed your task. This is the ONLY way to finish.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  };

  if (outputConfig) {
    const jsonSchema = zodToJsonSchema(outputConfig.schema);
    const {
      $schema: _$schema,
      definitions: _definitions,
      ...schema
    } = jsonSchema;
    completeTool.parameters!.properties![outputConfig.outputName] =
      schema as Schema;
    completeTool.parameters!.required!.push(outputConfig.outputName);
  }

  return completeTool;
}

/**
 * Processes all function calls requested by the model in a single turn.
 *
 * Dispatches each call (synchronously for `complete_task` and unauthorized
 * calls, asynchronously for registered tools), then assembles the response
 * parts.
 */
export async function processFunctionCalls(
  functionCalls: FunctionCall[],
  toolRegistry: ToolRegistry,
  runtimeContext: Config,
  messageBus: MessageBus,
  definition: AgentDefinition<z.ZodTypeAny>,
  emitActivity: EmitActivityFn,
  signal: AbortSignal,
  promptId: string,
): Promise<FunctionCallProcessingResult> {
  const allowedToolNames = new Set(toolRegistry.getAllToolNames());
  allowedToolNames.add(TASK_COMPLETE_TOOL_NAME);

  let submittedOutput: string | null = null;
  let taskCompleted = false;

  const toolExecutionPromises: Array<Promise<ToolExecutionResult | void>> = [];
  const syncResponseParts: Part[] = [];
  let executableFunctionCallCount = 0;

  for (const [index, functionCall] of functionCalls.entries()) {
    const dispatch = dispatchSingleFunctionCall(
      functionCall,
      index,
      promptId,
      allowedToolNames,
      runtimeContext,
      messageBus,
      definition,
      emitActivity,
      signal,
      taskCompleted,
      submittedOutput,
    );
    if (dispatch.kind === 'skip') {
      // Hook-restricted or otherwise filtered; do nothing.
    } else if (dispatch.kind === 'complete-task') {
      executableFunctionCallCount += 1;
      taskCompleted = dispatch.taskCompleted;
      submittedOutput = dispatch.submittedOutput;
      syncResponseParts.push(...dispatch.syncParts);
    } else if (dispatch.kind === 'unauthorized') {
      executableFunctionCallCount += 1;
      syncResponseParts.push(...dispatch.syncParts);
    } else {
      executableFunctionCallCount += 1;
      toolExecutionPromises.push(dispatch.promise);
    }
  }

  return assembleToolResponses(
    executableFunctionCallCount,
    syncResponseParts,
    toolExecutionPromises,
    submittedOutput,
    taskCompleted,
  );
}

/** Discriminated result for dispatching a single function call. */
type FunctionCallDispatch =
  | { kind: 'skip' }
  | {
      kind: 'complete-task';
      taskCompleted: boolean;
      submittedOutput: string | null;
      syncParts: Part[];
    }
  | { kind: 'unauthorized'; syncParts: Part[] }
  | { kind: 'execute'; promise: Promise<ToolExecutionResult | void> };

/**
 * Decide how to handle a single function call within a turn.
 *
 * Returns a discriminated result so the caller can process without multiple
 * break/continue statements.
 */
function dispatchSingleFunctionCall(
  functionCall: FunctionCall,
  index: number,
  promptId: string,
  allowedToolNames: Set<string>,
  runtimeContext: Config,
  messageBus: MessageBus,
  definition: AgentDefinition<z.ZodTypeAny>,
  emitActivity: EmitActivityFn,
  signal: AbortSignal,
  currentTaskCompleted: boolean,
  currentSubmittedOutput: string | null,
): FunctionCallDispatch {
  const callId = functionCall.id ?? `${promptId}-${index}`;
  const args = functionCall.args ?? {};
  const hookAllowedTools =
    getHookRestrictedAllowedToolsForFunctionCall(functionCall);
  if (isHookRestrictedToolCall(functionCall, hookAllowedTools)) {
    return { kind: 'skip' };
  }

  emitActivity('TOOL_CALL_START', { name: functionCall.name, args });

  if (functionCall.name === TASK_COMPLETE_TOOL_NAME) {
    const result = handleCompleteTaskCall(
      functionCall,
      callId,
      args,
      currentTaskCompleted,
      currentSubmittedOutput,
      definition,
      emitActivity,
    );
    return {
      kind: 'complete-task',
      taskCompleted: result.taskCompleted,
      submittedOutput: result.submittedOutput,
      syncParts: result.syncParts,
    };
  }

  if (!allowedToolNames.has(functionCall.name as string)) {
    const syncParts: Part[] = [];
    handleUnauthorizedToolCall(functionCall, callId, syncParts, emitActivity);
    return { kind: 'unauthorized', syncParts };
  }

  // ToolRegistry is not needed here; allowedToolNames already captures it.
  return {
    kind: 'execute',
    promise: createToolExecutionPromise(
      functionCall,
      callId,
      args,
      signal,
      promptId,
      runtimeContext,
      messageBus,
      emitActivity,
    ),
  };
}

/** Handles a `complete_task` function call, returning updated state and response parts. */
function handleCompleteTaskCall(
  functionCall: FunctionCall,
  callId: string,
  args: Record<string, unknown>,
  currentTaskCompleted: boolean,
  currentSubmittedOutput: string | null,
  definition: AgentDefinition<z.ZodTypeAny>,
  emitActivity: EmitActivityFn,
): {
  taskCompleted: boolean;
  submittedOutput: string | null;
  syncParts: Part[];
} {
  const syncParts: Part[] = [];

  if (currentTaskCompleted) {
    const error =
      'Task already marked complete in this turn. Ignoring duplicate call.';
    syncParts.push({
      functionResponse: {
        name: TASK_COMPLETE_TOOL_NAME,
        response: { error },
        id: callId,
      },
    });
    emitActivity('ERROR', {
      context: 'tool_call',
      name: functionCall.name,
      error,
    });
    return {
      taskCompleted: currentTaskCompleted,
      submittedOutput: currentSubmittedOutput,
      syncParts,
    };
  }

  const { outputConfig } = definition;

  if (outputConfig) {
    const result = processCompleteTaskOutput(
      functionCall,
      callId,
      args,
      outputConfig,
      definition,
      emitActivity,
    );
    syncParts.push(...result.syncParts);
    return {
      taskCompleted: result.taskCompleted,
      submittedOutput: result.submittedOutput,
      syncParts,
    };
  }

  syncParts.push({
    functionResponse: {
      name: TASK_COMPLETE_TOOL_NAME,
      response: { status: 'Task marked complete.' },
      id: callId,
    },
  });
  emitActivity('TOOL_CALL_END', {
    name: functionCall.name,
    output: 'Task marked complete.',
  });

  return {
    taskCompleted: true,
    submittedOutput: 'Task completed successfully.',
    syncParts,
  };
}

/** Processes the output argument of a `complete_task` call when outputConfig is present. */
function processCompleteTaskOutput(
  functionCall: FunctionCall,
  callId: string,
  args: Record<string, unknown>,
  outputConfig: OutputConfig,
  definition: AgentDefinition<z.ZodTypeAny>,
  emitActivity: EmitActivityFn,
): {
  taskCompleted: boolean;
  submittedOutput: string | null;
  syncParts: Part[];
} {
  const syncParts: Part[] = [];
  const outputName = outputConfig.outputName;

  if (args[outputName] !== undefined) {
    const outputValue = args[outputName];
    const validationResult = outputConfig.schema.safeParse(outputValue);

    if (!validationResult.success) {
      const error = `Output validation failed: ${JSON.stringify(validationResult.error.flatten())}`;
      syncParts.push({
        functionResponse: {
          name: TASK_COMPLETE_TOOL_NAME,
          response: { error },
          id: callId,
        },
      });
      emitActivity('ERROR', {
        context: 'tool_call',
        name: functionCall.name,
        error,
      });
      return { taskCompleted: false, submittedOutput: null, syncParts };
    }

    const validatedOutput = validationResult.data;
    let submittedOutput: string;
    if (definition.processOutput) {
      submittedOutput = definition.processOutput(validatedOutput);
    } else if (typeof outputValue === 'string') {
      submittedOutput = outputValue;
    } else {
      submittedOutput = JSON.stringify(outputValue, null, 2);
    }

    syncParts.push({
      functionResponse: {
        name: TASK_COMPLETE_TOOL_NAME,
        response: { result: 'Output submitted and task completed.' },
        id: callId,
      },
    });
    emitActivity('TOOL_CALL_END', {
      name: functionCall.name,
      output: 'Output submitted and task completed.',
    });
    return { taskCompleted: true, submittedOutput, syncParts };
  }

  // Missing required output argument
  const error = `Missing required argument '${outputName}' for completion.`;
  syncParts.push({
    functionResponse: {
      name: TASK_COMPLETE_TOOL_NAME,
      response: { error },
      id: callId,
    },
  });
  emitActivity('ERROR', {
    context: 'tool_call',
    name: functionCall.name,
    error,
  });
  return { taskCompleted: false, submittedOutput: null, syncParts };
}

/** Handles an unauthorized tool call by pushing an error response. */
function handleUnauthorizedToolCall(
  functionCall: FunctionCall,
  callId: string,
  syncResponseParts: Part[],
  emitActivity: EmitActivityFn,
): void {
  const error = `Unauthorized tool call: '${functionCall.name}' is not available to this agent.`;

  debugLogger.warn(`[AgentExecutor] Blocked call: ${error}`);

  syncResponseParts.push({
    functionResponse: {
      name: functionCall.name as string,
      id: callId,
      response: { error },
    },
  });

  emitActivity('ERROR', {
    context: 'tool_call_unauthorized',
    name: functionCall.name,
    callId,
    error,
  });
}

/** Creates an async promise that executes a standard tool call. */
function createToolExecutionPromise(
  functionCall: FunctionCall,
  callId: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  promptId: string,
  runtimeContext: Config,
  messageBus: MessageBus,
  emitActivity: EmitActivityFn,
): Promise<ToolExecutionResult | void> {
  const hookAllowedTools =
    getHookRestrictedAllowedToolsForFunctionCall(functionCall);
  const requestInfo: ToolCallRequestInfo = {
    callId,
    name: functionCall.name as string,
    args,
    isClientInitiated: true,
    prompt_id: promptId,
    ...(hookAllowedTools !== undefined
      ? { hookRestrictedAllowedTools: hookAllowedTools }
      : {}),
  };

  return (async () => {
    const completed = await executeToolCall(
      runtimeContext,
      requestInfo,
      signal,
      { messageBus },
    );
    const toolResponse = completed.response;

    if (toolResponse.error) {
      emitActivity('ERROR', {
        context: 'tool_call',
        name: functionCall.name,
        error: toolResponse.error.message,
      });
    } else {
      emitActivity('TOOL_CALL_END', {
        name: functionCall.name,
        output: toolResponse.resultDisplay,
      });
    }

    return {
      responseParts: toolResponse.responseParts,
      partialResult:
        typeof toolResponse.resultDisplay === 'string'
          ? toolResponse.resultDisplay
          : null,
    };
  })();
}

/** Assembles all tool response parts and returns the final result. */
async function assembleToolResponses(
  executableFunctionCallCount: number,
  syncResponseParts: Part[],
  toolExecutionPromises: Array<Promise<ToolExecutionResult | void>>,
  submittedOutput: string | null,
  taskCompleted: boolean,
): Promise<FunctionCallProcessingResult> {
  const asyncResults = await Promise.all(toolExecutionPromises);

  const toolResponseParts: Part[] = [...syncResponseParts];
  let partialResult: string | null = null;
  for (const result of asyncResults) {
    if (result) {
      toolResponseParts.push(...result.responseParts);
      if (result.partialResult !== null) {
        partialResult = result.partialResult;
      }
    }
  }

  if (
    executableFunctionCallCount > 0 &&
    toolResponseParts.length === 0 &&
    !taskCompleted
  ) {
    toolResponseParts.push({
      text: 'All tool calls failed or were unauthorized. Please analyze the errors and try an alternative approach.',
    });
  }

  return {
    nextMessage: { role: 'user', parts: toolResponseParts },
    submittedOutput,
    taskCompleted,
    partialResult,
  };
}
