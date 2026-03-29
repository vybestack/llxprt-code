/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Tool call dispatch, emit handling, and response building
 * for subagents.
 *
 * Extracted from subagent.ts as part of Issue #1581 (Phase 3).
 */

import type { DebugLogger } from '../debug/DebugLogger.js';
import type { Config } from '../config/config.js';
import type { ToolCallRequestInfo, ToolCallResponseInfo } from './turn.js';
import {
  executeToolCall,
  type ToolExecutionConfig,
} from './nonInteractiveToolExecutor.js';
import type { Part, FunctionCall, Content } from '@google/genai';
import type {
  AgentRuntimeContext,
  ToolRegistryView,
} from '../runtime/AgentRuntimeContext.js';
import { ToolErrorType } from '../tools/tool-error.js';
import type { ToolResultDisplay } from '../tools/tools.js';
import type { CompletedToolCall } from './coreToolScheduler.js';
import { TodoStore } from '../tools/todo-store.js';
import { debugLogger } from '../utils/debugLogger.js';
import { SubagentTerminateMode, type OutputObject } from './subagentTypes.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { createSchedulerConfig } from './subagentRuntimeSetup.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

export function isFatalToolError(
  errorType: ToolErrorType | undefined,
): boolean {
  return (
    errorType === ToolErrorType.TOOL_DISABLED ||
    errorType === ToolErrorType.TOOL_NOT_REGISTERED
  );
}

export function extractToolDetail(
  resultDisplay?: ToolResultDisplay,
  error?: Error,
): string | undefined {
  if (error?.message) {
    return error.message;
  }
  if (typeof resultDisplay === 'string') {
    return resultDisplay;
  }
  if (
    resultDisplay &&
    typeof resultDisplay === 'object' &&
    'message' in resultDisplay &&
    typeof (resultDisplay as { message?: unknown }).message === 'string'
  ) {
    return (resultDisplay as { message: string }).message;
  }
  const missingResultDisplay: string | undefined = void 0;
  return missingResultDisplay;
}

export function buildToolUnavailableMessage(
  toolName: string,
  resultDisplay?: ToolResultDisplay,
  error?: Error,
): string {
  const detail = extractToolDetail(resultDisplay, error);
  const baseMessage = `Tool "${toolName}" is not available in this environment.`;
  return detail
    ? `${baseMessage} ${detail}`
    : `${baseMessage} Please continue without using it.`;
}

// ---------------------------------------------------------------------------
// Fuzzy tool name resolution
// ---------------------------------------------------------------------------

export function resolveToolName(
  rawName: string | undefined,
  toolsView: ToolRegistryView,
): string | null {
  if (!rawName) {
    const missingToolName: string | null = null;
    return missingToolName;
  }

  const candidates = new Set<string>();
  const trimmed = rawName.trim();
  if (trimmed) {
    candidates.add(trimmed);
    candidates.add(trimmed.toLowerCase());
  }

  if (trimmed.endsWith('Tool')) {
    const withoutSuffix = trimmed.slice(0, -4);
    if (withoutSuffix) {
      candidates.add(withoutSuffix);
      candidates.add(withoutSuffix.toLowerCase());
      candidates.add(toSnakeCase(withoutSuffix));
    }
  }

  candidates.add(toSnakeCase(trimmed));

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (toolsView.getToolMetadata(candidate)) {
      return candidate;
    }
  }

  const unresolvedToolName: string | null = null;
  return unresolvedToolName;
}

// ---------------------------------------------------------------------------
// Output finalization
// ---------------------------------------------------------------------------

export function finalizeOutput(output: OutputObject): void {
  const message = output.final_message;
  if (typeof message === 'string' && message.trim().length > 0) {
    return;
  }

  const emittedVars = output.emitted_vars ?? {};
  const emittedEntries = Object.entries(emittedVars)
    .filter(
      ([, value]) =>
        value !== undefined &&
        value !== null &&
        String(value).trim().length > 0,
    )
    .map(([key, value]) => `${key}=${String(value)}`);

  let baseMessage: string;
  switch (output.terminate_reason) {
    case SubagentTerminateMode.GOAL:
      baseMessage = 'Completed the requested task.';
      break;
    case SubagentTerminateMode.TIMEOUT:
      baseMessage = 'Stopped because the time limit was reached.';
      break;
    case SubagentTerminateMode.MAX_TURNS:
      baseMessage = 'Stopped because the maximum number of turns was reached.';
      break;
    case SubagentTerminateMode.ERROR:
    default:
      baseMessage = 'Stopped due to an unrecoverable error.';
      break;
  }

  const varsSuffix =
    emittedEntries.length > 0
      ? ` Emitted variables: ${emittedEntries.join(', ')}.`
      : '';

  output.final_message = `${baseMessage}${varsSuffix}`.trim();
}

// ---------------------------------------------------------------------------
// Emit value handling (interactive mode — from Turn)
// ---------------------------------------------------------------------------

export interface EmitValueContext {
  output: OutputObject;
  onMessage?: (message: string) => void;
  subagentId: string;
  logger: DebugLogger;
}

export function handleEmitValueCall(
  request: ToolCallRequestInfo,
  ctx: EmitValueContext,
): Part[] {
  const args = request.args ?? {};
  const variableName =
    typeof args.emit_variable_name === 'string'
      ? args.emit_variable_name
      : typeof args.emitVariableName === 'string'
        ? args.emitVariableName
        : '';
  const variableValue =
    typeof args.emit_variable_value === 'string'
      ? args.emit_variable_value
      : typeof args.emitVariableValue === 'string'
        ? args.emitVariableValue
        : '';

  if (variableName && variableValue) {
    ctx.output.emitted_vars[variableName] = variableValue;
    const message = `Emitted variable ${variableName} successfully`;
    if (ctx.onMessage) {
      ctx.onMessage(`[${ctx.subagentId}] ${message}`);
    }
    return [
      {
        functionResponse: {
          id: request.callId,
          name: request.name,
          response: {
            emit_variable_name: variableName,
            emit_variable_value: variableValue,
            message,
          },
        },
      },
    ];
  }

  const errorMessage =
    'self_emitvalue requires emit_variable_name and emit_variable_value arguments.';
  ctx.logger.warn(
    () => `Subagent ${ctx.subagentId} failed to emit value: ${errorMessage}`,
  );
  return [
    {
      functionResponse: {
        id: request.callId,
        name: request.name,
        response: { error: errorMessage },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Build parts from completed scheduler calls (interactive mode)
// ---------------------------------------------------------------------------

export interface BuildPartsContext {
  onMessage?: (message: string) => void;
  subagentId: string;
  logger: DebugLogger;
}

export function buildPartsFromCompletedCalls(
  completedCalls: CompletedToolCall[],
  ctx: BuildPartsContext,
): Part[] {
  const aggregate: Part[] = [];
  for (const call of completedCalls) {
    if (call.response?.responseParts?.length) {
      for (const part of call.response.responseParts) {
        if ('functionCall' in part) {
          continue;
        }
        aggregate.push(part);
      }
    } else {
      aggregate.push({
        functionResponse: {
          id: call.request.callId,
          name: call.request.name,
          response: {
            output: `Tool ${call.request.name} completed without response.`,
          },
        },
      });
    }

    if (call.status === 'error') {
      const errorMessage =
        call.response?.error?.message ??
        call.response?.resultDisplay ??
        'Tool execution failed.';
      ctx.logger.warn(
        () =>
          `Subagent ${ctx.subagentId} tool '${call.request.name}' failed: ${errorMessage}`,
      );
    } else if (call.status === 'cancelled') {
      ctx.logger.warn(
        () =>
          `Subagent ${ctx.subagentId} tool '${call.request.name}' was cancelled.`,
      );
    }

    const toolCanUpdateOutput =
      call.status === 'success' && call.tool?.canUpdateOutput === true;

    const display = call.response?.resultDisplay;
    if (
      typeof display === 'string' &&
      ctx.onMessage &&
      display.trim() &&
      !toolCanUpdateOutput
    ) {
      ctx.onMessage(display);
    }
  }
  return aggregate;
}

// ---------------------------------------------------------------------------
// Non-interactive tool call processing
// ---------------------------------------------------------------------------

export interface ProcessFunctionCallsContext {
  output: OutputObject;
  subagentId: string;
  logger: DebugLogger;
  toolExecutorContext: ToolExecutionConfig;
  config: Config;
  messageBus?: MessageBus;
}

export async function processFunctionCalls(
  functionCalls: FunctionCall[],
  abortController: AbortController,
  promptId: string,
  ctx: ProcessFunctionCallsContext,
): Promise<Content[]> {
  const toolResponseParts: Part[] = [];

  for (const functionCall of functionCalls) {
    const callId = functionCall.id ?? `${functionCall.name}-${Date.now()}`;
    const requestInfo: ToolCallRequestInfo = {
      callId,
      name: functionCall.name as string,
      args: functionCall.args ?? {},
      isClientInitiated: true,
      prompt_id: promptId,
      agentId: ctx.subagentId,
    };

    ctx.logger.debug(
      () =>
        `Subagent ${ctx.subagentId} executing tool '${requestInfo.name}' with args=${JSON.stringify(requestInfo.args)}`,
    );

    const toolResponse = await executeNonInteractiveTool(
      functionCall,
      requestInfo,
      callId,
      abortController,
      ctx,
    );

    logToolResult(functionCall, toolResponse, ctx);

    if (isFatalToolError(toolResponse.errorType)) {
      const fatalMessage = buildToolUnavailableMessage(
        functionCall.name as string,
        toolResponse.resultDisplay,
        toolResponse.error,
      );
      ctx.logger.warn(
        () =>
          `Subagent ${ctx.subagentId} cannot use tool '${functionCall.name}': ${fatalMessage}`,
      );
      toolResponseParts.push({ text: fatalMessage });
      ctx.output.final_message = fatalMessage;
      continue;
    }

    if (toolResponse.responseParts) {
      for (const part of toolResponse.responseParts) {
        if ('functionCall' in part) {
          continue;
        }
        toolResponseParts.push(part);
      }
    }
  }

  if (functionCalls.length > 0 && toolResponseParts.length === 0) {
    toolResponseParts.push({
      text: 'All tool calls failed. Please analyze the errors and try an alternative approach.',
    });
  }

  return [{ role: 'user', parts: toolResponseParts }];
}

async function executeNonInteractiveTool(
  functionCall: FunctionCall,
  requestInfo: ToolCallRequestInfo,
  callId: string,
  abortController: AbortController,
  ctx: ProcessFunctionCallsContext,
): Promise<ToolCallResponseInfo> {
  if (functionCall.name === 'self_emitvalue') {
    const valName = String(requestInfo.args['emit_variable_name']);
    const valVal = String(requestInfo.args['emit_variable_value']);
    ctx.output.emitted_vars[valName] = valVal;

    const successMessage = `Emitted variable ${valName} successfully`;
    return {
      callId,
      responseParts: [
        {
          functionResponse: {
            id: callId,
            name: requestInfo.name,
            response: {
              emit_variable_name: valName,
              emit_variable_value: valVal,
              message: successMessage,
            },
          },
        },
      ],
      resultDisplay: successMessage,
      error: undefined,
      errorType: undefined,
      agentId: requestInfo.agentId,
    };
  }

  const schedulerConfig = createSchedulerConfig(
    ctx.toolExecutorContext,
    ctx.config,
    { interactive: false },
  );
  const completed = await executeToolCall(
    schedulerConfig,
    requestInfo,
    abortController.signal,
    { messageBus: ctx.messageBus },
  );
  return completed.response;
}

function logToolResult(
  functionCall: FunctionCall,
  toolResponse: ToolCallResponseInfo,
  ctx: ProcessFunctionCallsContext,
): void {
  if (toolResponse.error) {
    debugLogger.error(
      `Error executing tool ${functionCall.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
    );
    ctx.logger.warn(
      () =>
        `Subagent ${ctx.subagentId} tool '${functionCall.name}' failed: ${toolResponse.error?.message}`,
    );
  } else {
    ctx.logger.debug(
      () =>
        `Subagent ${ctx.subagentId} tool '${functionCall.name}' completed successfully`,
    );
  }
}

// ---------------------------------------------------------------------------
// Todo completion prompt
// ---------------------------------------------------------------------------

export async function buildTodoCompletionPrompt(
  runtimeContext: AgentRuntimeContext,
  subagentId: string,
  logger: DebugLogger,
): Promise<string | null> {
  const sessionId = runtimeContext.state.sessionId;
  if (!sessionId) {
    const missingSessionPrompt: string | null = null;
    return missingSessionPrompt;
  }

  try {
    let todos = await new TodoStore(sessionId, subagentId).readTodos();
    if (todos.length === 0) {
      todos = await new TodoStore(sessionId).readTodos();
    }

    if (todos.length === 0) {
      const noTodosPrompt: string | null = null;
      return noTodosPrompt;
    }

    const outstanding = todos.filter((todo) => todo.status !== 'completed');

    if (outstanding.length === 0) {
      const noOutstandingPrompt: string | null = null;
      return noOutstandingPrompt;
    }

    const previewCount = Math.min(3, outstanding.length);
    const previewLines = outstanding
      .slice(0, previewCount)
      .map((todo) => `- ${todo.content}`);
    if (outstanding.length > previewCount) {
      previewLines.push(`- ... and ${outstanding.length - previewCount} more`);
    }

    return [
      'You still have todos in your todo list. Complete them before finishing.',
      previewLines.length > 0
        ? `Outstanding items:\n${previewLines.join('\n')}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
  } catch (error) {
    logger.warn(
      () =>
        `Subagent ${subagentId} could not inspect todos: ${error instanceof Error ? error.message : String(error)}`,
    );
    const todoInspectionUnavailable: string | null = null;
    return todoInspectionUnavailable;
  }
}
