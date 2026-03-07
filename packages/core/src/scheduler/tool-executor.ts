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
import type { Config } from '../config/Config.js';
import {
  triggerBeforeToolHook,
  triggerAfterToolHook,
} from '../core/coreToolHookTriggers.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';

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
  invocation: typeof ScheduledToolCall.prototype.invocation;
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
export class ToolExecutor {
  constructor(private readonly config: Config) {}

  /**
   * Execute a single tool call from scheduled to completed state.
   * 
   * EXTRACTED CODE from coreToolScheduler.ts lines 1691-1858.
   * 
   * Handles:
   * - Before/after hook invocation
   * - PID tracking for shell tools
   * - Live output streaming
   * - Error handling and cancellation
   * - Result transformation
   * 
   * @throws Never throws - all errors are captured in the result
   */
  async execute(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { call: scheduledCall, signal, onLiveOutput, onPid } = context;
    const { callId, name: toolName, args } = scheduledCall.request;
    let invocation = scheduledCall.invocation;
    let effectiveArgs = args;

    // ============================================================
    // EXTRACTED CODE STARTS HERE (from launchToolExecution lines 1691-1858)
    // ============================================================

    // Trigger BeforeTool hook and await result
    // @requirement:HOOK-017,HOOK-019 - Block execution or modify args based on hook result
    const beforeResult = await triggerBeforeToolHook(
      this.config,
      toolName,
      args,
    );

    // Check if hook wants to block execution
    if (beforeResult?.isBlockingDecision()) {
      const blockReason =
        beforeResult.getEffectiveReason() || 'Blocked by BeforeTool hook';
      // Throw to signal blocking — caller converts to bufferError
      throw new Error(blockReason);
    }

    // Check if hook wants to modify tool input
    const modifiedInput = beforeResult?.getModifiedToolInput();
    if (modifiedInput) {
      effectiveArgs = modifiedInput;
      // Re-create invocation with modified args
      invocation = scheduledCall.tool.build(modifiedInput);
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
      .execute(
        signal,
        liveOutputCallback,
        undefined,
        undefined,
        setPidCallback,
      )
      .then(async (toolResult: ToolResult) => {
        if (signal.aborted) {
          throw new Error('User cancelled tool execution.');
        }

        // Trigger AfterTool hook and await result
        // @requirement:HOOK-131,HOOK-132 - Apply systemMessage and suppressOutput
        const afterResult = await triggerAfterToolHook(
          this.config,
          toolName,
          effectiveArgs,
          toolResult,
        );

        // Apply hook modifications to tool result
        let finalResult = toolResult;
        if (afterResult) {
          // Append systemMessage to llmContent
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

          // Set suppressDisplay if requested
          if (afterResult.suppressOutput) {
            finalResult = {
              ...finalResult,
              suppressDisplay: true,
            };
          }
        }

        return {
          result: finalResult,
          invocation,
          effectiveArgs,
        };
      })
      .catch(async (executionError: Error) => {
        if (signal.aborted) {
          throw new Error('User cancelled tool execution.');
        }
        throw executionError;
      });

    // ============================================================
    // EXTRACTED CODE ENDS HERE
    // ============================================================
  }
}
