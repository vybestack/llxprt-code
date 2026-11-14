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

import type {
  ScheduledToolCall,
  ValidatingToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { ToolResult } from '@vybestack/llxprt-code-tools';
import {
  buildExecutionScope,
  type NestedExecutionComposition,
} from './nested-execution.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import {
  triggerBeforeToolHook,
  triggerAfterToolHook,
} from '@vybestack/llxprt-code-core/core/coreToolHookTriggers.js';
import type { LiveOutputUpdate } from '@vybestack/llxprt-code-core/utils/terminalSerializer.js';

/**
 * Execution context for a single tool call.
 */
export interface ToolExecutionContext {
  call: ScheduledToolCall;
  signal: AbortSignal;
  hookOwner?: HookExecutionOwner;
  onLiveOutput?: (callId: string, update: LiveOutputUpdate) => void;
  onPid?: (callId: string, pid: number) => void;
}

/**
 * Result of tool execution with before/after hook application.
 */
export interface PreparedToolExecution {
  readonly invocation: ScheduledToolCall['invocation'];
  readonly effectiveArgs: Record<string, unknown>;
  readonly beforeResult: Awaited<ReturnType<typeof triggerBeforeToolHook>>;
}

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
  if (hookResult?.shouldStopExecution() === true) {
    const reason = hookResult.getEffectiveReason();
    throw new ToolHookStopError(
      reason && reason.length > 0 ? reason : `Stopped by ${hookPhase} hook`,
    );
  }
  if (hookResult?.isBlockingDecision() === true) {
    const blockReason = hookResult.getEffectiveReason();
    throw new Error(
      blockReason && blockReason.length > 0
        ? blockReason
        : `Blocked by ${hookPhase} hook`,
    );
  }
}

/**
 * Apply hook output decorations (systemMessage/additionalContext/suppressOutput)
 * to a tool result so they are visible to downstream model turns.
 */
function applyHookOutputModifications(
  hookResult:
    | {
        systemMessage?: string;
        getAdditionalContext(): string | undefined;
        suppressOutput?: boolean;
      }
    | undefined,
  toolResult: ToolResult,
): ToolResult {
  if (!hookResult) return toolResult;

  let finalResult = toolResult;
  const systemMessage = hookResult.systemMessage;
  const additionalContext = hookResult.getAdditionalContext();
  const appendedTexts = [systemMessage, additionalContext].filter(
    (text): text is string => !!text,
  );

  if (appendedTexts.length > 0) {
    const existingContent =
      typeof finalResult.llmContent === 'string'
        ? finalResult.llmContent
        : JSON.stringify(finalResult.llmContent);
    const appendText = appendedTexts.join('\n\n');

    // The hook changed the text a programmatic caller would otherwise read
    // from the typed value, so the typed value no longer describes it.
    const { structuredOutput: _replaced, ...textResult } = finalResult;
    finalResult = {
      ...textResult,
      llmContent: `${existingContent}\n\n${appendText}`,
    };
  }

  if (hookResult.suppressOutput === true) {
    finalResult = { ...finalResult, suppressDisplay: true };
  }
  return finalResult;
}

function bindHookCancellation(
  owner: HookExecutionOwner | undefined,
  signal: AbortSignal,
): HookExecutionOwner | undefined {
  return owner === undefined
    ? undefined
    : {
        ...owner,
        signal:
          owner.signal === undefined
            ? signal
            : AbortSignal.any([owner.signal, signal]),
      };
}

/**
 * A BeforeTool or AfterTool hook asked to stop (`continue: false`). The call
 * fails with ToolErrorType.STOP_EXECUTION, which a caller that runs several
 * calls on its own (a code mode script) treats as the end of its run rather
 * than as an ordinary tool failure.
 */
export class ToolHookStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolHookStopError';
  }
}

export class ToolArgumentValidationError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : String(cause),
      cause instanceof Error ? { cause } : undefined,
    );
    this.name = 'ToolArgumentValidationError';
  }
}

export class ToolExecutor {
  /**
   * @param nestedExecution Composition attached to every execution scope as
   * its nested-execution port; absent for schedulers without nested runs.
   */
  constructor(private readonly nestedExecution?: NestedExecutionComposition) {}

  /** Prepares a call that runs without hooks: its arguments are final. */
  prepareDirect(call: ValidatingToolCall): PreparedToolExecution {
    return {
      invocation: call.invocation,
      effectiveArgs: structuredClone(call.request.args),
      beforeResult: undefined,
    };
  }

  /**
   * Runs BeforeTool once and builds the invocation policy will evaluate. A
   * hook-modified input that does not validate fails the call.
   */
  async prepareWithHook(
    call: ValidatingToolCall,
    signal: AbortSignal,
    hookOwner: HookExecutionOwner,
  ): Promise<PreparedToolExecution> {
    const { name: toolName, args } = call.request;
    const serverName = (call.invocation as { _serverName?: string })
      ._serverName;
    const beforeResult = await triggerBeforeToolHook(
      toolName,
      args,
      serverName ? { server_name: serverName } : undefined,
      bindHookCancellation(hookOwner, signal),
    );
    checkHookDecision(beforeResult, 'BeforeTool');

    const modifiedInput = beforeResult?.getModifiedToolInput();
    const effectiveArgs = structuredClone(modifiedInput ?? args);
    let invocation = call.invocation;
    if (modifiedInput) {
      try {
        invocation = call.tool.build(effectiveArgs);
      } catch (error) {
        throw new ToolArgumentValidationError(error);
      }
    }
    return { invocation, effectiveArgs, beforeResult };
  }

  async execute(
    context: ToolExecutionContext,
    prepared: PreparedToolExecution,
  ): Promise<ToolExecutionResult> {
    const {
      call: scheduledCall,
      signal,
      hookOwner,
      onLiveOutput,
      onPid,
    } = context;
    const scope = buildExecutionScope(
      scheduledCall.request,
      this.nestedExecution,
      hookOwner,
    );
    const { callId, name: toolName } = scheduledCall.request;
    const { invocation, effectiveArgs, beforeResult } = prepared;
    const serverName = (invocation as { _serverName?: string })._serverName;
    const mcpContext = serverName ? { server_name: serverName } : undefined;
    const executionOwner = bindHookCancellation(hookOwner, signal);
    const liveOutputCallback = scheduledCall.tool.canUpdateOutput
      ? (update: LiveOutputUpdate) => onLiveOutput?.(callId, update)
      : undefined;
    const setPidCallback = (pid: number) => onPid?.(callId, pid);

    return invocation
      .execute(
        signal,
        liveOutputCallback,
        undefined,
        undefined,
        setPidCallback,
        scope,
      )
      .then(async (toolResult: ToolResult) => {
        if (signal.aborted) throw new Error('User cancelled tool execution.');
        const beforeDecoratedResult = applyHookOutputModifications(
          beforeResult,
          toolResult,
        );
        const afterResult = await triggerAfterToolHook(
          toolName,
          effectiveArgs,
          beforeDecoratedResult,
          mcpContext,
          executionOwner,
        );
        checkHookDecision(afterResult, 'AfterTool');
        return {
          result: applyHookOutputModifications(
            afterResult,
            beforeDecoratedResult,
          ),
          invocation,
          effectiveArgs,
        };
      })
      .catch((executionError: Error) => {
        if (signal.aborted) throw new Error('User cancelled tool execution.');
        throw executionError;
      });
  }
}
