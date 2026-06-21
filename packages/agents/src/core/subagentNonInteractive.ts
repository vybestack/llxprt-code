/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Non-interactive subagent execution path.
 *
 * Pure helpers extracted from SubAgentScope to keep the coordinator file
 * under the max-lines budget. These functions orchestrate the
 * non-interactive turn loop: sending messages, consuming the provider
 * stream, parsing function calls, and dispatching tool results.
 *
 * All dependencies are passed explicitly via the NonInteractiveRunContext.
 *
 * @see project-plans/issue1581/README.md
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  type FunctionCall,
  type FunctionDeclaration,
  type Content,
} from '@google/genai';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import {
  StreamEventType,
  type StreamEvent,
  type ChatSession,
} from './chatSession.js';
import {
  filterHookRestrictedParts,
  filterHookRestrictedFunctionCalls,
  getHookRestrictedAllowedTools,
  getHookRestrictedFunctionCallsFromParts,
  mergeHookRestrictedFunctionCalls,
} from './hookToolRestrictions.js';
import type { ToolExecutionConfig } from './nonInteractiveToolExecutor.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import {
  SubagentTerminateMode,
  type OutputObject,
  type OutputConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { ExecutionLoopContext } from './subagentExecution.js';
import {
  checkTerminationConditions,
  processNonInteractiveTextResponse,
  handleExecutionError,
  checkGoalCompletion,
} from './subagentExecution.js';
import {
  resolveToolName,
  finalizeOutput,
  processFunctionCalls,
  buildTodoCompletionPrompt,
} from './subagentToolProcessing.js';

// ---------------------------------------------------------------------------
// Run context — carries all collaborators the non-interactive path needs
// ---------------------------------------------------------------------------

/**
 * Collaborator bag for the non-interactive execution path.
 * Mirrors the SubAgentScope private fields consumed by runNonInteractive.
 */
export interface NonInteractiveRunContext {
  readonly output: OutputObject;
  readonly subagentId: string;
  readonly name: string;
  readonly runtimeContext: AgentRuntimeContext;
  readonly logger: DebugLogger;
  readonly config: Config;
  readonly runConfig: RunConfig;
  readonly outputConfig?: OutputConfig;
  readonly toolExecutorContext: ToolExecutionConfig;
  readonly messageBus?: MessageBus;
}

/** Result of a single non-interactive turn iteration. */
type LoopIterationResult =
  | { action: 'stop' }
  | { action: 'abort' }
  | { action: 'continue'; messages: Content[] };

// ---------------------------------------------------------------------------
// Stream consumption helpers
// ---------------------------------------------------------------------------

/**
 * Read the next event from the non-interactive stream, applying the idle
 * timeout watchdog when configured.
 */
export async function readNextNonInteractiveEvent(
  iterator: AsyncIterator<StreamEvent, unknown>,
  abortController: AbortController,
  timeoutController: AbortController,
  timeoutSignal: AbortSignal,
  effectiveTimeoutMs: number,
  output: OutputObject,
): Promise<IteratorResult<StreamEvent, unknown>> {
  if (effectiveTimeoutMs > 0) {
    return nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: effectiveTimeoutMs,
      signal: timeoutSignal,
      onTimeout: () => {
        if (abortController.signal.aborted === true) {
          return;
        }
        output.terminate_reason = SubagentTerminateMode.TIMEOUT;
        timeoutController.abort();
        abortController.abort(createAbortError());
      },
      createTimeoutError: () => createAbortError(),
    });
  }
  return iterator.next();
}

/**
 * Collect function calls and text from a single CHUNK stream event,
 * respecting hook-restricted tool filtering.
 */
export function collectNonInteractiveChunk(
  resp: StreamEvent & { type: StreamEventType.CHUNK },
  functionCalls: FunctionCall[],
  currentTurn: number,
  logger: DebugLogger,
  subagentId: string,
): { text: string; hookRestrictedAllowedTools: string[] | undefined } {
  const allowedTools = getHookRestrictedAllowedTools(resp.value);
  const parts = resp.value.candidates?.[0]?.content?.parts ?? [];
  const partCalls = getHookRestrictedFunctionCallsFromParts(
    parts,
    allowedTools,
  );
  const topLevelCalls = filterHookRestrictedFunctionCalls(
    resp.value.functionCalls ?? [],
    allowedTools,
  );
  const chunkCalls = mergeHookRestrictedFunctionCalls(partCalls, topLevelCalls);
  if (chunkCalls.length > 0) {
    functionCalls.push(...chunkCalls);
    logger.debug(
      () =>
        `Subagent ${subagentId} received ${chunkCalls.length} function calls on turn ${currentTurn}`,
    );
  }
  if (allowedTools === undefined) {
    return {
      text: resp.value.text ?? '',
      hookRestrictedAllowedTools: undefined,
    };
  }
  const filteredParts = filterHookRestrictedParts(parts, allowedTools);
  const filteredText = filteredParts
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string')
    .join('');
  return { text: filteredText, hookRestrictedAllowedTools: allowedTools };
}

/** Aggregated result of consuming the full non-interactive stream. */
export interface NonInteractiveStreamResult {
  functionCalls: FunctionCall[];
  textResponse: string;
  parseableTextResponse: string;
  hookRestrictedAllowedTools: string[] | undefined;
}

/** Empty stream result returned when the stream is aborted before reading. */
function emptyStreamResult(): NonInteractiveStreamResult {
  return {
    functionCalls: [],
    textResponse: '',
    parseableTextResponse: '',
    hookRestrictedAllowedTools: undefined,
  };
}

/**
 * Consume the full non-interactive provider stream, applying the idle-timeout
 * watchdog and aborting early when the runtime abort signal fires.
 */
export async function consumeNonInteractiveStream(
  responseStream: AsyncIterable<StreamEvent>,
  abortController: AbortController,
  currentTurn: number,
  config: Config,
  logger: DebugLogger,
  subagentId: string,
  output: OutputObject,
): Promise<NonInteractiveStreamResult> {
  const timeoutController = new AbortController();
  const timeoutSignal = timeoutController.signal;
  const onAbort = () => timeoutController.abort();
  abortController.signal.addEventListener('abort', onAbort, { once: true });
  if (abortController.signal.aborted === true) {
    onAbort();
    abortController.signal.removeEventListener('abort', onAbort);
    return emptyStreamResult();
  }

  const functionCalls: FunctionCall[] = [];
  let textResponse = '';
  let parseableTextResponse = '';
  let hookRestrictedAllowedTools: string[] | undefined;
  const iterator = responseStream[Symbol.asyncIterator]();
  const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(config);

  try {
    const readResult = await readStreamToCompletion(
      iterator,
      abortController,
      timeoutController,
      timeoutSignal,
      effectiveTimeoutMs,
      currentTurn,
      functionCalls,
      logger,
      subagentId,
      output,
    );
    textResponse = readResult.textResponse;
    parseableTextResponse = readResult.parseableTextResponse;
    if (readResult.aborted) {
      return {
        functionCalls: [],
        textResponse,
        parseableTextResponse,
        hookRestrictedAllowedTools,
      };
    }
    hookRestrictedAllowedTools = readResult.hookRestrictedAllowedTools;
  } finally {
    iterator.return?.(undefined).catch(() => {});
    timeoutController.abort();
    abortController.signal.removeEventListener('abort', onAbort);
  }

  return {
    functionCalls,
    textResponse,
    parseableTextResponse,
    hookRestrictedAllowedTools,
  };
}

/**
 * Internal: iterate the stream to completion, accumulating text and
 * function calls. Returns whether the stream was aborted mid-read.
 */
async function readStreamToCompletion(
  iterator: AsyncIterator<StreamEvent, unknown>,
  abortController: AbortController,
  timeoutController: AbortController,
  timeoutSignal: AbortSignal,
  effectiveTimeoutMs: number,
  currentTurn: number,
  functionCalls: FunctionCall[],
  logger: DebugLogger,
  subagentId: string,
  output: OutputObject,
): Promise<{
  textResponse: string;
  parseableTextResponse: string;
  hookRestrictedAllowedTools: string[] | undefined;
  aborted: boolean;
}> {
  let textResponse = '';
  let parseableTextResponse = '';
  let hookRestrictedAllowedTools: string[] | undefined;

  let result = await readNextNonInteractiveEvent(
    iterator,
    abortController,
    timeoutController,
    timeoutSignal,
    effectiveTimeoutMs,
    output,
  );
  while (result.done !== true) {
    const resp = result.value;
    const isRuntimeAborted = Boolean(abortController.signal.aborted);
    if (isRuntimeAborted) {
      return {
        textResponse,
        parseableTextResponse,
        hookRestrictedAllowedTools,
        aborted: true,
      };
    }
    if (resp.type === StreamEventType.CHUNK) {
      const chunkResult = collectNonInteractiveChunk(
        resp,
        functionCalls,
        currentTurn,
        logger,
        subagentId,
      );
      hookRestrictedAllowedTools =
        chunkResult.hookRestrictedAllowedTools ?? hookRestrictedAllowedTools;
      textResponse += chunkResult.text;
      parseableTextResponse += chunkResult.text;
    }
    result = await readNextNonInteractiveEvent(
      iterator,
      abortController,
      timeoutController,
      timeoutSignal,
      effectiveTimeoutMs,
      output,
    );
  }

  return {
    textResponse,
    parseableTextResponse,
    hookRestrictedAllowedTools,
    aborted: false,
  };
}

// ---------------------------------------------------------------------------
// Turn execution
// ---------------------------------------------------------------------------

/**
 * Execute a single non-interactive turn: send the message, consume the
 * stream, and parse any textual tool calls.
 */
export async function runNonInteractiveTurn(
  chat: ChatSession,
  currentMessages: Content[],
  toolsList: FunctionDeclaration[],
  abortController: AbortController,
  currentTurn: number,
  sessionId: string,
  subagentId: string,
  execCtx: ExecutionLoopContext,
  config: Config,
  logger: DebugLogger,
  output: OutputObject,
): Promise<{ functionCalls: FunctionCall[]; textResponse: string }> {
  const messageParams = {
    message: currentMessages[0]?.parts ?? [],
    config: {
      abortSignal: abortController.signal,
      tools: [{ functionDeclarations: toolsList }],
    },
  };

  const responseStream = await chat.sendMessageStream(
    messageParams,
    `${sessionId}#${subagentId}#${currentTurn}`,
  );

  const {
    functionCalls: rawCalls,
    textResponse,
    parseableTextResponse,
    hookRestrictedAllowedTools,
  } = await consumeNonInteractiveStream(
    responseStream,
    abortController,
    currentTurn,
    config,
    logger,
    subagentId,
    output,
  );
  if (abortController.signal.aborted === true) {
    return { functionCalls: [], textResponse: '' };
  }

  let functionCalls = rawCalls;
  if (parseableTextResponse) {
    const result = processNonInteractiveTextResponse(
      parseableTextResponse,
      functionCalls,
      execCtx,
      resolveToolName,
      hookRestrictedAllowedTools,
    );
    functionCalls = result.functionCalls;
  }

  return { functionCalls, textResponse };
}

/**
 * Dispatch the result of a non-interactive turn: either execute function
 * calls or run the goal-completion check.
 */
export async function dispatchNonInteractiveTurnResult(
  functionCalls: FunctionCall[],
  abortController: AbortController,
  promptId: string,
  currentTurn: number,
  execCtx: ExecutionLoopContext,
  ctx: NonInteractiveRunContext,
): Promise<Content[] | null> {
  if (functionCalls.length > 0) {
    return processFunctionCalls(functionCalls, abortController, promptId, {
      output: ctx.output,
      subagentId: ctx.subagentId,
      logger: ctx.logger,
      toolExecutorContext: ctx.toolExecutorContext,
      config: ctx.config,
      messageBus: ctx.messageBus,
    });
  }
  const todoReminder = await buildTodoCompletionPrompt(
    ctx.runtimeContext,
    ctx.subagentId,
    ctx.logger,
  );
  return checkGoalCompletion(execCtx, todoReminder, currentTurn);
}

// ---------------------------------------------------------------------------
// Main non-interactive loop (extracted to keep coordinator lean)
// ---------------------------------------------------------------------------

/**
 * Run one iteration of the non-interactive loop body. Returns a
 * discriminated result so the caller loop has a single control branch.
 */
async function runNonInteractiveLoopIteration(
  chat: ChatSession,
  toolsList: FunctionDeclaration[],
  abortController: AbortController,
  currentMessages: Content[],
  turnCounter: { value: number },
  startTime: number,
  execCtx: ExecutionLoopContext,
  ctx: NonInteractiveRunContext,
): Promise<LoopIterationResult> {
  const check = checkTerminationConditions(
    turnCounter.value,
    startTime,
    execCtx,
  );
  if (check.shouldStop) return { action: 'stop' };

  const currentTurn = turnCounter.value++;
  const sessionId = ctx.runtimeContext.state.sessionId;
  const promptId = `${sessionId}#${ctx.subagentId}#${currentTurn}`;
  ctx.logger.debug(
    () => `Subagent ${ctx.subagentId} turn=${currentTurn} promptId=${promptId}`,
  );

  const { functionCalls } = await runNonInteractiveTurn(
    chat,
    currentMessages,
    toolsList,
    abortController,
    currentTurn,
    sessionId,
    ctx.subagentId,
    execCtx,
    ctx.config,
    ctx.logger,
    ctx.output,
  );
  if (abortController.signal.aborted === true) return { action: 'abort' };

  const recheck = checkTerminationConditions(
    turnCounter.value,
    startTime,
    execCtx,
  );
  if (recheck.shouldStop) return { action: 'stop' };

  const nextMessages = await dispatchNonInteractiveTurnResult(
    functionCalls,
    abortController,
    promptId,
    currentTurn,
    execCtx,
    ctx,
  );
  if (!nextMessages) return { action: 'stop' };
  return { action: 'continue', messages: nextMessages };
}

/**
 * Execute the full non-interactive subagent run loop.
 *
 * This is the top-level entry point called by SubAgentScope.runNonInteractive.
 * It owns the try/catch/finally wrapping and the loop that delegates each
 * iteration to {@link runNonInteractiveLoopIteration}.
 */
export async function executeNonInteractiveRun(
  chat: ChatSession,
  toolsList: FunctionDeclaration[],
  abortController: AbortController,
  initialMessages: Content[],
  startTime: number,
  execCtx: ExecutionLoopContext,
  ctx: NonInteractiveRunContext,
  cleanup: () => void,
): Promise<void> {
  let currentMessages = initialMessages;
  const turnCounter = { value: 0 };

  try {
    let keepRunning = true;
    while (keepRunning) {
      const iteration = await runNonInteractiveLoopIteration(
        chat,
        toolsList,
        abortController,
        currentMessages,
        turnCounter,
        startTime,
        execCtx,
        ctx,
      );
      if (iteration.action === 'abort') {
        return;
      }
      if (iteration.action === 'stop') {
        keepRunning = false;
      } else {
        currentMessages = iteration.messages;
      }
    }
    finalizeOutput(ctx.output);
  } catch (error) {
    if (ctx.output.terminate_reason !== SubagentTerminateMode.TIMEOUT) {
      handleExecutionError(error, execCtx);
    }
    finalizeOutput(ctx.output);
    throw error;
  } finally {
    cleanup();
  }
}
