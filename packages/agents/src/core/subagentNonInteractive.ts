/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamTimeoutPolicy } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
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

import {
  SubagentTerminateMode,
  type OutputConfig,
  type OutputObject,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type {
  ContentBlock,
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import { getToolCallBlocks } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import {
  StreamEventType,
  type ChatSession,
  type StreamEvent,
} from './chatSession.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';
import type { ExecutionLoopContext } from './subagentExecution.js';
import {
  GeneratedOutputCounter,
  checkGoalCompletion,
  checkOutputBudget,
  checkTerminationConditions,
  handleExecutionError,
  processNonInteractiveTextResponse,
  recordTurnOutputTokens,
} from './subagentExecution.js';
import { completeWithGoal, finalizeOutput } from './subagentToolProcessing.js';
import {
  SCOPE_LOCAL_EMIT_TOOL_NAME,
  canonicalizeToolName,
} from './toolGovernance.js';

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
  readonly sessionId: string;
  readonly logger: DebugLogger;
  readonly runConfig: RunConfig;
  readonly outputConfig?: OutputConfig;
  readonly modelParameters?: AdmittedModelParameters;
  readonly streamTimeoutPolicy: StreamTimeoutPolicy;
  readonly imagePayloadBudgetBytes: number;
  readonly streamModel: (
    message: ContentBlock[],
    tools: ToolDeclaration[],
    signal: AbortSignal,
    promptId: string,
    modelParameters?: AdmittedModelParameters,
  ) => ReturnType<ChatSession['sendMessageStream']>;
  readonly executeToolCalls: (
    calls: ToolCallBlock[],
    signal: AbortController,
    promptId: string,
    allowedToolNames?: readonly string[],
  ) => Promise<IContent[]>;
  readonly readTodoCompletionPrompt: () => Promise<string | null>;
}

/** Result of a single non-interactive turn iteration. */
type LoopIterationResult =
  | { action: 'stop' }
  | { action: 'abort' }
  | { action: 'continue'; messages: IContent[] };

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
  functionCalls: ToolCallBlock[],
  currentTurn: number,
  logger: DebugLogger,
  subagentId: string,
): { text: string; hookRestrictedAllowedTools: string[] | undefined } {
  const chunk = resp.value;
  const allowedTools = chunk.hookRestrictions?.allowedToolNames;
  const blocks = chunk.content.blocks;
  const filteredBlocks = filterHookRestrictedBlocks(blocks, allowedTools);
  const chunkCalls = getToolCallBlocks(filteredBlocks);
  if (chunkCalls.length > 0) {
    functionCalls.push(...chunkCalls);
    logger.debug(
      () =>
        `Subagent ${subagentId} received ${chunkCalls.length} function calls on turn ${currentTurn}`,
    );
  }
  const chunkText = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b as { text: string }).text)
    .join('');
  if (allowedTools === undefined) {
    return {
      text: chunkText,
      hookRestrictedAllowedTools: undefined,
    };
  }
  const filteredText = filteredBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { text: filteredText, hookRestrictedAllowedTools: allowedTools };
}

/** Aggregated result of consuming the full non-interactive stream. */
export interface NonInteractiveStreamResult {
  functionCalls: ToolCallBlock[];
  textResponse: string;
  parseableTextResponse: string;
  hookRestrictedAllowedTools: string[] | undefined;
  reportedOutputTokens: number | undefined;
  outputCharacterCount: number;
}

/** Empty stream result returned when the stream is aborted before reading. */
function emptyStreamResult(): NonInteractiveStreamResult {
  return {
    functionCalls: [],
    textResponse: '',
    parseableTextResponse: '',
    hookRestrictedAllowedTools: undefined,
    reportedOutputTokens: undefined,
    outputCharacterCount: 0,
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
  timeoutPolicy: StreamTimeoutPolicy,
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

  const functionCalls: ToolCallBlock[] = [];
  let textResponse = '';
  let parseableTextResponse = '';
  let hookRestrictedAllowedTools: string[] | undefined;
  let reportedOutputTokens: number | undefined;
  let outputCharacterCount = 0;
  const iterator = responseStream[Symbol.asyncIterator]();
  const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(timeoutPolicy);

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
    reportedOutputTokens = readResult.reportedOutputTokens;
    outputCharacterCount = readResult.outputCharacterCount;
    if (readResult.aborted) {
      return {
        functionCalls: [],
        textResponse,
        parseableTextResponse,
        hookRestrictedAllowedTools,
        reportedOutputTokens,
        outputCharacterCount,
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
    reportedOutputTokens,
    outputCharacterCount,
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
  functionCalls: ToolCallBlock[],
  logger: DebugLogger,
  subagentId: string,
  output: OutputObject,
): Promise<{
  textResponse: string;
  parseableTextResponse: string;
  hookRestrictedAllowedTools: string[] | undefined;
  reportedOutputTokens: number | undefined;
  outputCharacterCount: number;
  aborted: boolean;
}> {
  let textResponse = '';
  let parseableTextResponse = '';
  let hookRestrictedAllowedTools: string[] | undefined;
  let reportedOutputTokens: number | undefined;
  const outputCounter = new GeneratedOutputCounter();

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
    if (abortController.signal.aborted) {
      return {
        textResponse,
        parseableTextResponse,
        hookRestrictedAllowedTools,
        reportedOutputTokens,
        outputCharacterCount: outputCounter.total,
        aborted: true,
      };
    }
    if (resp.type === StreamEventType.CHUNK) {
      outputCounter.add(resp.value.content.blocks);
      reportedOutputTokens =
        resp.value.usage?.completionTokens ?? reportedOutputTokens;
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
    reportedOutputTokens,
    outputCharacterCount: outputCounter.total,
    aborted: false,
  };
}

// ---------------------------------------------------------------------------
// Turn execution
// ---------------------------------------------------------------------------

function hasEffectiveEmitter(
  toolsList: readonly ToolDeclaration[],
  hookRestrictedAllowedTools: readonly string[] | undefined,
): boolean {
  const emitterName = canonicalizeToolName(SCOPE_LOCAL_EMIT_TOOL_NAME);
  const emitterDeclared = toolsList.some(
    (declaration) => canonicalizeToolName(declaration.name) === emitterName,
  );
  const emitterAllowed =
    hookRestrictedAllowedTools === undefined ||
    hookRestrictedAllowedTools.some(
      (name) => canonicalizeToolName(name) === emitterName,
    );
  return emitterDeclared && emitterAllowed;
}

function resolveNonInteractiveToolName(
  rawName: string | undefined,
  resolveToolName: ExecutionLoopContext['resolveToolName'],
  effectiveEmitterAvailable: boolean,
): string | null {
  if (
    effectiveEmitterAvailable &&
    rawName !== undefined &&
    canonicalizeToolName(rawName) ===
      canonicalizeToolName(SCOPE_LOCAL_EMIT_TOOL_NAME)
  ) {
    return SCOPE_LOCAL_EMIT_TOOL_NAME;
  }
  return resolveToolName(rawName);
}

export async function runNonInteractiveTurn(
  currentMessages: IContent[],
  toolsList: ToolDeclaration[],
  abortController: AbortController,
  currentTurn: number,
  execCtx: ExecutionLoopContext,
  ctx: NonInteractiveRunContext,
): Promise<{
  functionCalls: ToolCallBlock[];
  textResponse: string;
  effectiveEmitterAvailable: boolean;
}> {
  const responseStream = await ctx.streamModel(
    currentMessages[0]?.blocks ?? [],
    toolsList,
    abortController.signal,
    `${ctx.sessionId}#${ctx.subagentId}#${currentTurn}`,
    ctx.modelParameters,
  );
  const {
    functionCalls: rawCalls,
    textResponse,
    parseableTextResponse,
    hookRestrictedAllowedTools,
    reportedOutputTokens,
    outputCharacterCount,
  } = await consumeNonInteractiveStream(
    responseStream,
    abortController,
    currentTurn,
    ctx.streamTimeoutPolicy,
    ctx.logger,
    ctx.subagentId,
    ctx.output,
  );
  if (abortController.signal.aborted === true) {
    return {
      functionCalls: [],
      textResponse: '',
      effectiveEmitterAvailable: false,
    };
  }
  recordTurnOutputTokens(execCtx, reportedOutputTokens, outputCharacterCount);
  const effectiveEmitterAvailable = hasEffectiveEmitter(
    toolsList,
    hookRestrictedAllowedTools,
  );

  let functionCalls = rawCalls;
  if (parseableTextResponse) {
    const result = processNonInteractiveTextResponse(
      parseableTextResponse,
      functionCalls,
      execCtx,
      (rawName) =>
        resolveNonInteractiveToolName(
          rawName,
          execCtx.resolveToolName,
          effectiveEmitterAvailable,
        ),
      hookRestrictedAllowedTools,
    );
    functionCalls = result.functionCalls;
  }

  return {
    functionCalls,
    textResponse,
    effectiveEmitterAvailable,
  };
}

/**
 * Dispatch the result of a non-interactive turn: either execute function
 * calls or run the goal-completion check.
 */
export async function dispatchNonInteractiveTurnResult(
  functionCalls: ToolCallBlock[],
  abortController: AbortController,
  promptId: string,
  currentTurn: number,
  execCtx: ExecutionLoopContext,
  ctx: NonInteractiveRunContext,
  effectiveEmitterAvailable: boolean,
): Promise<IContent[] | null> {
  const requiredOutputKeys = Object.keys(ctx.outputConfig?.outputs ?? {});
  const emittedOutputKeys = Object.keys(ctx.output.emitted_vars);
  const missingOutputKeys = requiredOutputKeys.filter(
    (key) => !emittedOutputKeys.includes(key),
  );
  if (missingOutputKeys.length > 0 && !effectiveEmitterAvailable) {
    const errorMessage =
      `Required tool ${SCOPE_LOCAL_EMIT_TOOL_NAME} is unavailable while required outputs are missing: ` +
      `${missingOutputKeys.join(', ')}.`;
    ctx.output.terminate_reason = SubagentTerminateMode.ERROR;
    ctx.output.final_message = errorMessage;
    ctx.logger.warn(
      () =>
        `Subagent ${ctx.subagentId} cannot complete output emission: ${errorMessage}`,
    );
    return null;
  }
  if (functionCalls.length > 0) {
    const nextMessages = await ctx.executeToolCalls(
      functionCalls,
      abortController,
      promptId,
    );
    const emittedKeysAfterToolCalls = Object.keys(ctx.output.emitted_vars);
    const completedDeclaredOutputs =
      requiredOutputKeys.length > 0 &&
      requiredOutputKeys.every((key) =>
        emittedKeysAfterToolCalls.includes(key),
      );
    if (completedDeclaredOutputs) {
      completeWithGoal(ctx.output);
      return null;
    }
    return nextMessages;
  }
  const todoReminder = await ctx.readTodoCompletionPrompt();
  return checkGoalCompletion(execCtx, todoReminder, currentTurn);
}

// ---------------------------------------------------------------------------
// Main non-interactive loop (extracted to keep coordinator lean)
// ---------------------------------------------------------------------------

/**
 * Type guard: returns true when nextMessages is non-null AND non-empty.
 *
 * Issue #2410: `processFunctionCalls` can return `[]` (an empty, truthy
 * array) when all tool calls are hook-restricted. The old guard
 * `!nextMessages` only caught `null`/`undefined` — an empty array slipped
 * through (`![] === false`) and propagated a zero-part user message into
 * provider history. This type guard centralizes the corrected check so it
 * can be unit-tested in isolation.
 */
export function hasNonInteractiveMessages(
  nextMessages: IContent[] | null,
): nextMessages is IContent[] {
  return nextMessages !== null && nextMessages.length > 0;
}

/**
 * Run one iteration of the non-interactive loop body. Returns a
 * discriminated result so the caller loop has a single control branch.
 */
async function runNonInteractiveLoopIteration(
  toolsList: ToolDeclaration[],
  abortController: AbortController,
  currentMessages: IContent[],
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
  const promptId = `${ctx.sessionId}#${ctx.subagentId}#${currentTurn}`;
  ctx.logger.debug(
    () => `Subagent ${ctx.subagentId} turn=${currentTurn} promptId=${promptId}`,
  );

  const { functionCalls, effectiveEmitterAvailable } =
    await runNonInteractiveTurn(
      currentMessages,
      toolsList,
      abortController,
      currentTurn,
      execCtx,
      ctx,
    );
  if (abortController.signal.aborted === true) return { action: 'abort' };

  // Only the output budget is re-checked here. Re-checking the turn and time
  // limits between receiving a response and dispatching its tool calls throws
  // away work the model just did: a subagent on its last allowed turn would
  // emit tool calls and have them silently discarded. The loop head already
  // enforces both limits, so stopping there instead costs one dispatch and
  // keeps the result. The interactive loop was corrected the same way, and the
  // two paths must not disagree about when a run ends.
  if (checkOutputBudget(execCtx).shouldStop) return { action: 'stop' };

  const nextMessages = await dispatchNonInteractiveTurnResult(
    functionCalls,
    abortController,
    promptId,
    currentTurn,
    execCtx,
    ctx,
    effectiveEmitterAvailable,
  );
  // `processFunctionCalls` returns `[]` (an empty, truthy array) when no
  // tool calls were executed. `!nextMessages` only catches null/undefined,
  // so an empty array would slip through and propagate a zero-part user
  // message into provider history (issue #2410). Treat null and empty
  // array the same as "no further messages" and stop the loop.
  if (!hasNonInteractiveMessages(nextMessages)) {
    return { action: 'stop' };
  }
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
  toolsList: ToolDeclaration[],
  abortController: AbortController,
  initialMessages: IContent[],
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
