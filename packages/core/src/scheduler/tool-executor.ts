/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P04
 * @requirement TS-EXEC-001 through TS-EXEC-007
 *
 * Tool executor module — extracted from coreToolScheduler.ts launchToolExecution.
 * Executes a single tool with hooks, PID tracking, output streaming, and error handling.
 *
 * This is an EXTRACTION from coreToolScheduler.ts lines 1691-1858.
 * The code is CUT and PASTED with minimal adaptation for module boundaries.
 */

import type { ScheduledToolCall } from './types.js';
import type { ToolResult } from '../tools/tools.js';
import type { Config } from '../config/config.js';
import {
  triggerBeforeToolHook,
  triggerAfterToolHook,
} from '../core/coreToolHookTriggers.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import { debugLogger } from '../utils/debugLogger.js';

/**
 * Execution context for a single tool call.
 */
export interface ToolExecutionContext {
  call: ScheduledToolCall;
  signal: AbortSignal;
  onLiveOutput?: (callId: string, chunk: string | AnsiOutput) => void;
  onPid?: (callId: string, pid: number) => void;
}

/**
 * Result of tool execution with before/after hook application.
 */
export interface ToolExecutionResult {
  result: ToolResult;
  invocation: ScheduledToolCall['invocation'];
  effectiveArgs: Record<string, unknown>;
}

/**
 * Executes a single tool call with hooks, PID tracking, output streaming,
 * and error handling.
 *
 * EXTRACTED FROM: coreToolScheduler.ts launchToolExecution (lines 1691-1858)
 *
 * This class encapsulates the single-tool execution logic that was previously
 * embedded in CoreToolScheduler. The code is MOVED, not rewritten.
 */
/**
 * Check a hook result for stop/block decisions and throw if needed.
 */
function checkHookDecision(
  hookResult:
    | {
        shouldStopExecution(): boolean;
        isBlockingDecision(): boolean;
        getEffectiveReason(): string | undefined;
      }
    | undefined,
  hookPhase: string,
): void {
  if (hookResult?.shouldStopExecution()) {
    const stopError = new Error(
      hookResult.getEffectiveReason() || `Stopped by ${hookPhase} hook`,
    );
    (stopError as Error & { isStopExecution?: boolean }).isStopExecution = true;
    throw stopError;
  }
  if (hookResult?.isBlockingDecision()) {
    throw new Error(
      hookResult.getEffectiveReason() || `Blocked by ${hookPhase} hook`,
    );
  }
}

/**
 * Apply after-hook modifications (systemMessage, suppressOutput) to a tool result.
 */
function applyAfterHookModifications(
  afterResult:
    | {
        systemMessage?: string;
        getAdditionalContext(): string | undefined;
        suppressOutput?: boolean;
      }
    | undefined,
  toolResult: ToolResult,
): ToolResult {
  if (afterResult == null) return toolResult;

  let finalResult = toolResult;
  const systemMessage = afterResult.systemMessage;
  const additionalContext = afterResult.getAdditionalContext();
  if (systemMessage || additionalContext) {
    const appendText = systemMessage || additionalContext || '';
    const existingContent =
      typeof finalResult.llmContent === 'string'
        ? finalResult.llmContent
        : JSON.stringify(finalResult.llmContent);
    finalResult = {
      ...finalResult,
      llmContent: `${existingContent}

${appendText}`,
    };
  }
  if (afterResult.suppressOutput) {
    finalResult = { ...finalResult, suppressDisplay: true };
  }
  return finalResult;
}

export class ToolExecutor {
  constructor(private readonly config: Config) {}

  /**
   * Execute a single tool call from scheduled to completed state.
   */
  async execute(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { call: scheduledCall, signal, onLiveOutput, onPid } = context;
    const { callId, name: toolName, args } = scheduledCall.request;
    let invocation = scheduledCall.invocation;
    let effectiveArgs = args;

    const serverName = (invocation as { _serverName?: string })._serverName;
    const mcpContext = serverName ? { server_name: serverName } : undefined;

    const beforeResult = await triggerBeforeToolHook(
      this.config,
      toolName,
      args,
      mcpContext,
    );
    checkHookDecision(beforeResult, 'BeforeTool');

    const modifiedInput = beforeResult?.getModifiedToolInput();
    if (modifiedInput != null) {
      effectiveArgs = modifiedInput;
      try {
        invocation = scheduledCall.tool.build(modifiedInput);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        debugLogger.warn(
          `Failed to rebuild tool invocation after input modification: ${errorMessage}`,
        );
      }
    }

    const liveOutputCallback = scheduledCall.tool.canUpdateOutput
      ? (outputChunk: string | AnsiOutput) => {
          onLiveOutput?.(callId, outputChunk);
        }
      : undefined;
    const setPidCallback = (pid: number) => {
      onPid?.(callId, pid);
    };

    return invocation
      .execute(signal, liveOutputCallback, undefined, undefined, setPidCallback)
      .then(async (toolResult: ToolResult) => {
        if (signal.aborted) throw new Error('User cancelled tool execution.');

        const afterResult = await triggerAfterToolHook(
          this.config,
          toolName,
          effectiveArgs,
          toolResult,
          mcpContext,
        );
        checkHookDecision(afterResult, 'AfterTool');

        return {
          result: applyAfterHookModifications(afterResult, toolResult),
          invocation,
          effectiveArgs,
        };
      })
      .catch(async (executionError: Error) => {
        if (signal.aborted) throw new Error('User cancelled tool execution.');
        throw executionError;
      });
  }
}
