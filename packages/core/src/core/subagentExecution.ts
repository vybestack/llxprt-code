/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Execution loop helpers for subagent interactive and
 * non-interactive run modes.
 *
 * Functions here are pure or parameterized — they receive all dependencies
 * via arguments and never import from subagentRuntimeSetup.ts (enforced by
 * ESLint no-restricted-imports).
 *
 * @see project-plans/issue1581/README.md
 */

import type { DebugLogger } from '../debug/DebugLogger.js';
import {
  Config,
  type SchedulerCallbacks,
  type SchedulerOptions,
} from '../config/config.js';
import type { Content, FunctionCall } from '@google/genai';
import type { EmojiFilter } from '../filters/EmojiFilter.js';
import type { GemmaToolCallParser } from '../parsers/TextToolCallParser.js';
import type { ToolRegistryView } from '../runtime/AgentRuntimeContext.js';
import type { SubagentSchedulerFactory } from './subagentScheduler.js';
import type {
  CompletedToolCall,
  OutputUpdateHandler,
} from './coreToolScheduler.js';
import {
  SubagentTerminateMode,
  type OutputObject,
  type OutputConfig,
  type RunConfig,
} from './subagentTypes.js';

// ---------------------------------------------------------------------------
// Shared execution context — all loop helpers receive this instead of `this`
// ---------------------------------------------------------------------------

export interface ExecutionLoopContext {
  readonly output: OutputObject;
  readonly subagentId: string;
  readonly runConfig: RunConfig;
  readonly outputConfig?: OutputConfig;
  readonly emojiFilter?: EmojiFilter;
  readonly textToolParser: GemmaToolCallParser;
  readonly toolsView: ToolRegistryView;
  readonly logger: DebugLogger;
  onMessage?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Termination helpers
// ---------------------------------------------------------------------------

export interface TerminationCheck {
  shouldStop: boolean;
  reason?: SubagentTerminateMode;
}

/**
 * Check whether the loop should terminate (max_turns or max_time).
 */
export function checkTerminationConditions(
  turnCounter: number,
  startTime: number,
  ctx: Pick<
    ExecutionLoopContext,
    'runConfig' | 'subagentId' | 'output' | 'logger'
  >,
): TerminationCheck {
  if (ctx.runConfig.max_turns && turnCounter >= ctx.runConfig.max_turns) {
    ctx.output.terminate_reason = SubagentTerminateMode.MAX_TURNS;
    ctx.logger.warn(
      () =>
        `Subagent ${ctx.subagentId} reached max turns (${ctx.runConfig.max_turns})`,
    );
    return { shouldStop: true, reason: SubagentTerminateMode.MAX_TURNS };
  }
  const durationMin = (Date.now() - startTime) / (1000 * 60);
  if (durationMin >= ctx.runConfig.max_time_minutes) {
    ctx.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
    ctx.logger.warn(
      () =>
        `Subagent ${ctx.subagentId} reached time limit (${ctx.runConfig.max_time_minutes} minutes)`,
    );
    return { shouldStop: true, reason: SubagentTerminateMode.TIMEOUT };
  }
  return { shouldStop: false };
}

// ---------------------------------------------------------------------------
// Emoji filtering
// ---------------------------------------------------------------------------

export interface FilterResult {
  text: string;
  blocked: boolean;
  error?: string;
}

/**
 * Apply the emoji filter to a text string, dispatching system feedback via
 * onMessage when in warn mode.
 */
export function filterTextWithEmoji(
  text: string,
  ctx: Pick<ExecutionLoopContext, 'emojiFilter' | 'onMessage'>,
): FilterResult {
  if (!ctx.emojiFilter) {
    return { text, blocked: false };
  }
  const result = ctx.emojiFilter.filterText(text);
  if (result.blocked) {
    return {
      text: '',
      blocked: true,
      error: result.error ?? 'Content blocked by emoji filter',
    };
  }
  if (result.systemFeedback && ctx.onMessage) {
    ctx.onMessage(result.systemFeedback);
  }
  const filtered = typeof result.filtered === 'string' ? result.filtered : '';
  return { text: filtered, blocked: false };
}

// ---------------------------------------------------------------------------
// Goal completion check (post-turn)
// ---------------------------------------------------------------------------

/**
 * After a turn with no tool calls, determine what to send next:
 * - A todo-completion reminder, or
 * - A nudge for missing output variables, or
 * - null (goal is met — caller should break the loop).
 */
export async function checkGoalCompletion(
  ctx: Pick<
    ExecutionLoopContext,
    'output' | 'outputConfig' | 'subagentId' | 'logger'
  >,
  todoReminder: string | null,
  currentTurn: number,
): Promise<Content[] | null> {
  if (todoReminder) {
    ctx.logger.debug(
      () =>
        `Subagent ${ctx.subagentId} postponing completion until outstanding todos are addressed`,
    );
    return [{ role: 'user', parts: [{ text: todoReminder }] }];
  }

  if (!ctx.outputConfig || Object.keys(ctx.outputConfig.outputs).length === 0) {
    ctx.output.terminate_reason = SubagentTerminateMode.GOAL;
    return null;
  }

  const remainingVars = Object.keys(ctx.outputConfig.outputs).filter(
    (key) => !(key in ctx.output.emitted_vars),
  );

  if (remainingVars.length === 0) {
    ctx.output.terminate_reason = SubagentTerminateMode.GOAL;
    ctx.logger.debug(
      () =>
        `Subagent ${ctx.subagentId} satisfied output requirements on turn ${currentTurn}`,
    );
    return null;
  }

  const nudgeMessage = `You have stopped calling tools but have not emitted the following required variables: ${remainingVars.join(
    ', ',
  )}. Please use the 'self_emitvalue' tool to emit them now, or continue working if necessary.`;

  ctx.logger.debug(
    () =>
      `Subagent ${ctx.subagentId} nudging for outputs: ${remainingVars.join(', ')}`,
  );

  return [{ role: 'user', parts: [{ text: nudgeMessage }] }];
}

// ---------------------------------------------------------------------------
// Non-interactive text response processing (emoji filter + text tool parsing)
// ---------------------------------------------------------------------------

export interface NonInteractiveTextResult {
  functionCalls: FunctionCall[];
  cleanedText: string;
}

/**
 * Process a non-interactive text response: apply emoji filter, parse
 * textual tool calls via GemmaToolCallParser, update output.final_message.
 */
export function processNonInteractiveTextResponse(
  textResponse: string,
  existingFunctionCalls: FunctionCall[],
  ctx: Pick<
    ExecutionLoopContext,
    | 'emojiFilter'
    | 'onMessage'
    | 'textToolParser'
    | 'toolsView'
    | 'output'
    | 'subagentId'
    | 'logger'
  >,
  resolveToolNameFn: (
    rawName: string | undefined,
    toolsView: ToolRegistryView,
  ) => string | null,
): NonInteractiveTextResult {
  const messageToSend = textResponse;

  // Apply emoji filter for callback
  const callbackFilter = filterTextWithEmoji(messageToSend, ctx);
  if (callbackFilter.blocked) {
    ctx.output.terminate_reason = SubagentTerminateMode.ERROR;
    throw new Error(callbackFilter.error ?? 'Content blocked by emoji filter');
  }
  if (ctx.onMessage && callbackFilter.text) {
    ctx.onMessage(callbackFilter.text);
  }

  // Parse textual tool calls
  let cleanedText = messageToSend;
  let functionCalls = [...existingFunctionCalls];
  try {
    const parsedResult = ctx.textToolParser.parse(messageToSend);
    cleanedText = parsedResult.cleanedContent;
    if (parsedResult.toolCalls.length > 0) {
      const synthesized = synthesizeToolCalls(
        parsedResult.toolCalls,
        ctx,
        resolveToolNameFn,
      );
      if (synthesized.length > 0) {
        functionCalls = [...functionCalls, ...synthesized];
        ctx.logger.debug(
          () =>
            `Subagent ${ctx.subagentId} extracted ${synthesized.length} tool call(s) from text: ${synthesized
              .map((c) => c.name)
              .join(', ')}`,
        );
      }
    }
  } catch (error) {
    ctx.logger.warn(
      () =>
        `Subagent ${ctx.subagentId} failed to parse textual tool calls: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Apply emoji filter to final message
  const trimmedText = cleanedText.trim();
  if (trimmedText.length > 0) {
    const finalFilter = filterTextWithEmoji(trimmedText, ctx);
    if (finalFilter.blocked) {
      ctx.output.terminate_reason = SubagentTerminateMode.ERROR;
      throw new Error(finalFilter.error ?? 'Content blocked by emoji filter');
    }
    ctx.output.final_message = finalFilter.text;
  }

  const preview =
    cleanedText.length > 200 ? `${cleanedText.slice(0, 200)}…` : cleanedText;
  ctx.logger.debug(
    () => `Subagent ${ctx.subagentId} model response (truncated): ${preview}`,
  );

  return { functionCalls, cleanedText };
}

// ---------------------------------------------------------------------------
// Interactive text response processing (emoji filter only, no text tool parsing)
// ---------------------------------------------------------------------------

/**
 * Apply emoji filter to interactive streaming text, update output.final_message.
 */
export function processInteractiveTextResponse(
  textResponse: string,
  ctx: Pick<ExecutionLoopContext, 'emojiFilter' | 'output'>,
): void {
  if (!textResponse.trim()) return;
  const filter = filterTextWithEmoji(textResponse.trim(), ctx);
  if (filter.blocked) {
    ctx.output.terminate_reason = SubagentTerminateMode.ERROR;
    throw new Error(filter.error ?? 'Content blocked by emoji filter');
  }
  ctx.output.final_message = filter.text;
}

// ---------------------------------------------------------------------------
// Shared error handling
// ---------------------------------------------------------------------------

/**
 * Handle errors during execution loop — set terminate reason and final message.
 */
export function handleExecutionError(
  error: unknown,
  ctx: Pick<ExecutionLoopContext, 'output' | 'subagentId' | 'logger'>,
): void {
  ctx.logger.warn(
    () =>
      `Error during subagent execution for ${ctx.subagentId}: ${error instanceof Error ? error.message : String(error)}`,
  );
  ctx.output.terminate_reason = SubagentTerminateMode.ERROR;
  if (!ctx.output.final_message) {
    ctx.output.final_message =
      error instanceof Error ? error.message : String(error);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ParsedToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

function synthesizeToolCalls(
  toolCalls: ParsedToolCall[],
  ctx: Pick<ExecutionLoopContext, 'subagentId' | 'logger' | 'toolsView'>,
  resolveToolNameFn: (
    rawName: string | undefined,
    toolsView: ToolRegistryView,
  ) => string | null,
): FunctionCall[] {
  const synthesized: FunctionCall[] = [];
  toolCalls.forEach((call, index) => {
    const normalizedName = resolveToolNameFn(call.name, ctx.toolsView);
    if (!normalizedName) {
      ctx.logger.debug(
        () =>
          `Subagent ${ctx.subagentId} could not map textual tool name '${call.name}' to a registered tool`,
      );
      return;
    }
    synthesized.push({
      id: `parsed_${ctx.subagentId}_${Date.now()}_${index}`,
      name: normalizedName,
      args: call.arguments ?? {},
    });
  });
  return synthesized;
}

// ---------------------------------------------------------------------------
// Interactive scheduler initialization
// ---------------------------------------------------------------------------

/** Context needed to initialize an interactive scheduler. */
export interface InitSchedulerContext {
  schedulerConfig: Config;
  onMessage?: (message: string) => void;
  messageBus?: import('../index.js').MessageBus;
  subagentId: string;
  logger: DebugLogger;
}

/** Return type for the completion channel factory. */
export interface CompletionChannel {
  awaitCompletedCalls: () => Promise<CompletedToolCall[]>;
  handleCompletion: (calls: CompletedToolCall[]) => Promise<void>;
  outputUpdateHandler: OutputUpdateHandler;
}

/** Creates the resolved-call channel and output handler for an interactive scheduler. */
export function createCompletionChannel(
  ctx: Pick<InitSchedulerContext, 'onMessage'>,
): CompletionChannel {
  let pendingCompletedCalls: CompletedToolCall[] | null = null;
  let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;

  const awaitCompletedCalls = () => {
    if (pendingCompletedCalls) {
      const calls = pendingCompletedCalls;
      pendingCompletedCalls = null;
      return Promise.resolve(calls);
    }
    return new Promise<CompletedToolCall[]>((resolve) => {
      completionResolver = resolve;
    });
  };

  const outputUpdateHandler: OutputUpdateHandler = (_toolCallId, output) => {
    if (output && ctx.onMessage) {
      const textOutput =
        typeof output === 'string'
          ? output
          : output
              .map((line) => line.map((token) => token.text).join(''))
              .join('\n');
      ctx.onMessage(textOutput);
    }
  };

  const handleCompletion = async (calls: CompletedToolCall[]) => {
    if (completionResolver) {
      completionResolver(calls);
      completionResolver = null;
    } else {
      pendingCompletedCalls = calls;
    }
  };

  return { awaitCompletedCalls, handleCompletion, outputUpdateHandler };
}

/** Creates and returns the interactive scheduler and its dispose function. */
export async function initInteractiveScheduler(
  options: { schedulerFactory?: SubagentSchedulerFactory } | undefined,
  ctx: InitSchedulerContext,
) {
  const channel = createCompletionChannel(ctx);

  const schedulerPromise = options?.schedulerFactory
    ? Promise.resolve(
        options.schedulerFactory({
          schedulerConfig: ctx.schedulerConfig,
          onAllToolCallsComplete: channel.handleCompletion,
          outputUpdateHandler: channel.outputUpdateHandler,
          onToolCallsUpdate: undefined,
        }),
      )
    : (async () => {
        const sessionId = ctx.schedulerConfig.getSessionId();
        return (
          ctx.schedulerConfig as Config & {
            getOrCreateScheduler(
              sessionId: string,
              callbacks: SchedulerCallbacks,
              options?: SchedulerOptions,
              dependencies?: { messageBus?: import('../index.js').MessageBus },
            ): ReturnType<Config['getOrCreateScheduler']>;
          }
        ).getOrCreateScheduler(
          sessionId,
          {
            outputUpdateHandler: channel.outputUpdateHandler,
            onAllToolCallsComplete: channel.handleCompletion,
            onToolCallsUpdate: undefined,
            getPreferredEditor: () => undefined,
            onEditorClose: () => {},
          },
          undefined,
          { messageBus: ctx.messageBus },
        );
      })();

  let scheduler: Awaited<typeof schedulerPromise>;
  try {
    scheduler = await schedulerPromise;
  } catch (error) {
    ctx.logger.error(
      () =>
        `Subagent ${ctx.subagentId} failed to create scheduler: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    throw error;
  }

  const schedulerDispose = options?.schedulerFactory
    ? typeof scheduler.dispose === 'function'
      ? async () => scheduler.dispose?.()
      : async () => {}
    : async () =>
        ctx.schedulerConfig.disposeScheduler(
          ctx.schedulerConfig.getSessionId(),
        );

  return {
    scheduler: {
      schedule: scheduler.schedule,
      awaitCompletedCalls: channel.awaitCompletedCalls,
    },
    schedulerDispose,
  };
}
