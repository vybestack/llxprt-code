/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @requirement REQ-LOOP-001
 * @requirement REQ-LOOP-002
 *
 * Engine-owned multi-turn agentic loop.
 *
 * Runs: send message → stream turn → accumulate tool-call requests → schedule
 * tools (subject to policy via the ConfirmationCoordinator, and an optional
 * injected approval handler for ASK_USER) → await completion → build
 * functionResponse parts → feed back → repeat until the model stops requesting
 * tools. Cancellation via AbortSignal cleanly tears down the scheduler.
 *
 * Two injection points:
 *  - **Policy**: `config` carries the `PolicyEngine` and `ApprovalMode`. Pure
 *    engine logic — never touches UI. ALLOW/DENY are resolved synchronously
 *    inside the scheduler's ConfirmationCoordinator.
 *  - **Approval**: the optional `approvalHandler`, invoked only when policy
 *    returns `ASK_USER`. It resolves an {@link ApprovalResult} (outcome +
 *    optional payload) which the loop forwards back over the confirmation bus.
 *
 * Bus-native: when an `approvalHandler` is provided the loop subscribes to
 * `MessageBusType.TOOL_CONFIRMATION_REQUEST` and replies via
 * `messageBus.respondToConfirmation`. If no `approvalHandler` is provided,
 * headless callers should use a non-asking policy. An ASK_USER decision in
 * non-interactive mode is returned to the model as a safe tool error rather
 * than executing unapproved tools.
 */

import { randomUUID } from 'node:crypto';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { iContentFromAgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  AgentEventType,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { ToolSchedulerContract } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgenticLoopEvent, AgenticLoopOptions } from './types.js';
import { AgenticEventQueue } from './agenticEventQueue.js';
import {
  buildToolResponses,
  classifyCompletedTools,
  recordCancelledToolHistory,
  recordCompletedToolHistory,
} from './loopHelpers.js';

const logger = new DebugLogger('llxprt:agents:agentic-loop');

/**
 * Deduplicates ToolCallRequestInfo[] by callId, preserving insertion order.
 * Mirrors the CLI `deduplicateToolCallRequests` helper (issue #1040) without
 * pulling a CLI dependency into the engine.
 */
function deduplicateToolCallRequests(
  requests: ToolCallRequestInfo[],
): ToolCallRequestInfo[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    if (seen.has(request.callId)) {
      return false;
    }
    seen.add(request.callId);
    return true;
  });
}

function isTerminalStreamOutcome(type: AgentEventType): boolean {
  return (
    type === AgentEventType.Error ||
    type === AgentEventType.StreamIdleTimeout ||
    type === AgentEventType.UserCancelled ||
    type === AgentEventType.LoopDetected
  );
}

/** A mutable holder so promise callbacks can communicate state to the loop. */
interface TurnState {
  completionSettled: boolean;
}

/** Result of scheduling+awaiting tools for one turn. */
interface TurnToolResult {
  completed: CompletedToolCall[] | null;
}

interface StreamCollectionResult {
  shouldScheduleTools: boolean;
}

interface TurnRunResult {
  continueLoop: boolean;
  nextMessage: AgentMessageInput;
  allowSteerContinuation: boolean;
}

/**
 * @requirement REQ-LOOP-001
 * Engine-owned multi-turn agentic loop. Construct with
 * {@link AgenticLoopOptions} and iterate `run(message, signal)` to receive a
 * flat {@link AgenticLoopEvent} stream.
 */
function createCompletionController(): {
  resolveCompletion: (calls: CompletedToolCall[]) => void;
  completionPromise: Promise<CompletedToolCall[]>;
} {
  let resolver: ((calls: CompletedToolCall[]) => void) | null = null;
  let resolved = false;
  return {
    resolveCompletion(calls: CompletedToolCall[]) {
      if (resolved) return;
      resolved = true;
      resolver?.(calls);
    },
    completionPromise: new Promise<CompletedToolCall[]>((resolve) => {
      resolver = resolve;
    }),
  };
}

function wrapCompletionTask(
  completionPromise: Promise<CompletedToolCall[]>,
  state: { completionSettled: boolean },
): Promise<CompletedToolCall[] | null> {
  return completionPromise
    .then((c) => c)
    .catch(() => null)
    .finally(() => {
      state.completionSettled = true;
    });
}

export class AgenticLoop {
  private readonly agentClient: AgenticLoopOptions['agentClient'];
  private readonly config: AgenticLoopOptions['config'];
  private readonly messageBus: AgenticLoopOptions['messageBus'];
  private readonly approvalHandler?: AgenticLoopOptions['approvalHandler'];
  private readonly interactiveMode: boolean;
  private readonly displayCallbacks: AgenticLoopOptions['displayCallbacks'];
  private readonly ownedToolCallIds = new Set<string>();
  private promptCount = 0;
  private isRunning = false;
  /**
   * Pending steer messages injected via {@link injectSteer}. Drained at the
   * loop boundary (between turns) so the user text is appended only after all
   * tool results are closed — shape-safe across all provider formats.
   */
  private pendingSteer: string[] = [];
  /**
   * A scheduler-singleton key dedicated to this loop instance. The CLI main
   * scheduler is keyed by `config.getSessionId()`; reusing that key would make
   * the loop's `getOrCreateScheduler` call REPLACE the CLI's scheduler
   * callbacks (last-writer-wins) and never restore them on dispose. An isolated
   * key keeps the loop's transient per-turn scheduler separate from the CLI
   * main scheduler that serves client-initiated (e.g. slash-command) tools.
   */
  private readonly schedulerSessionId: string;

  constructor(options: AgenticLoopOptions) {
    this.agentClient = options.agentClient;
    this.config = options.config;
    this.messageBus = options.messageBus;
    this.approvalHandler = options.approvalHandler;
    this.interactiveMode = options.interactiveMode ?? false;
    this.displayCallbacks = options.displayCallbacks;
    this.schedulerSessionId = `${options.config.getSessionId()}#agentic-loop#${randomUUID()}`;
  }

  private generateInitialPromptId(): string {
    return `${this.config.getSessionId()}#agentic-loop#${randomUUID()}`;
  }

  private generateContinuationPromptId(initialPromptId: string): string {
    this.promptCount += 1;
    return `${initialPromptId}#continuation#${this.promptCount}`;
  }

  /**
   * Injects a user steer message into the active loop. The message is stashed
   * and drained at the next loop boundary (between turns), after all tool
   * results for the current turn have settled. This is shape-safe: the user
   * text is appended after closed tool_result blocks, which is valid in all
   * three provider formats (Gemini, Anthropic, OpenAI).
   *
   * If the loop is not running, the message is silently dropped — the caller
   * should queue it for the next turn instead.
   */
  injectSteer(text: string): void {
    if (!this.isRunning) {
      return;
    }
    this.pendingSteer.push(text);
  }

  /**
   * Drains all pending steer messages, joining them with newlines. Returns
   * null when there are none. Called only at the loop boundary by {@link run}.
   */
  private drainSteer(): string | null {
    if (this.pendingSteer.length === 0) {
      return null;
    }
    const text = this.pendingSteer.join('\n');
    this.pendingSteer = [];
    return text;
  }

  /**
   * Normalizes an {@link AgentMessageInput} into a `ContentBlock[]` so steer
   * text can be appended via spread. When `continueLoop` is true,
   * `nextMessage` always comes from {@link buildNextMessage} which returns
   * `ContentBlock[]`, but the type is the wider `AgentMessageInput`.
   */
  private toContentBlocks(message: AgentMessageInput): ContentBlock[] {
    return iContentFromAgentMessageInput(message).flatMap(
      (content) => content.blocks,
    );
  }

  /**
   * Builds the message for a steer continuation: when the model finished
   * without tool calls but the user steered during the final-answer stream,
   * the steer text alone becomes the next turn's message. Returns null when
   * there is no steer to act on (normal loop exit).
   */
  private steerWhenFinished(steerText: string | null): ContentBlock[] | null {
    return steerText ? [{ type: 'text', text: steerText }] : null;
  }

  /**
   * @requirement REQ-LOOP-002
   * Subscribe to confirmation requests on the bus and forward them to the
   * injected approval handler, replying via `respondToConfirmation`. Returns
   * an unsubscribe function. No-op when no approvalHandler was provided.
   */
  private wireApprovalHandler(): () => void {
    if (!this.approvalHandler) {
      return () => {};
    }
    const handler = this.approvalHandler;
    const bus = this.messageBus;
    let active = true;
    const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        const callId = request.toolCall.id;
        if (callId === undefined || !this.ownedToolCallIds.has(callId)) {
          return;
        }
        void handler(request)
          .then((result) => {
            if (!active || !this.ownedToolCallIds.has(callId)) {
              return;
            }
            bus.respondToConfirmation(
              request.correlationId,
              result.outcome,
              result.payload,
            );
          })
          .catch((error: unknown) => {
            if (!active || !this.ownedToolCallIds.has(callId)) {
              return;
            }
            // A rejecting approval handler must not leave the confirmation
            // unanswered (which would hang the loop). Respond with a safe
            // denial so the scheduler cancels the tool and the loop proceeds.
            logger.debug(
              () =>
                `approvalHandler rejected; denying confirmation: ${
                  error instanceof Error ? error.message : String(error)
                }`,
            );
            bus.respondToConfirmation(
              request.correlationId,
              ToolConfirmationOutcome.Cancel,
            );
          });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }

  /**
   * @requirement REQ-LOOP-001
   * @requirement REQ-LOOP-005
   * Run the multi-turn loop. Yields a flat {@link AgenticLoopEvent} stream
   * including tool-execution events. Stops when the model requests no tools,
   * or when `signal` aborts (clean teardown of the scheduler).
   *
   * `promptId` correlates the FIRST model turn with the caller's request
   * (telemetry/logging). When omitted, the loop generates one. Subsequent
   * continuation turns derive from the first-turn id so they cannot collide
   * with CLI top-level prompt ids that use the session counter namespace.
   */
  async *run(
    message: AgentMessageInput,
    signal: AbortSignal,
    promptId?: string,
  ): AsyncGenerator<AgenticLoopEvent> {
    if (this.isRunning) {
      throw new Error('AgenticLoop.run does not support concurrent executions');
    }
    this.isRunning = true;
    const unsubscribe = this.wireApprovalHandler();
    try {
      let currentMessage = message;
      const initialPromptId = promptId ?? this.generateInitialPromptId();
      let currentPromptId = initialPromptId;
      while (!signal.aborted) {
        const result = yield* this.runTurn(
          currentMessage,
          signal,
          currentPromptId,
        );
        const steerText = this.drainSteer();
        const steerContinuation =
          !result.continueLoop && result.allowSteerContinuation
            ? this.steerWhenFinished(steerText)
            : null;
        if (steerContinuation !== null) {
          currentMessage = steerContinuation;
          currentPromptId = this.generateContinuationPromptId(initialPromptId);
          continue;
        }
        if (!result.continueLoop) {
          return;
        }
        // Tools completed -> append steer text alongside the functionResponse
        // parts. Shape-safe: result.nextMessage contains closed tool results,
        // and the steer text comes after them.
        currentMessage = steerText
          ? [
              ...this.toContentBlocks(result.nextMessage),
              { type: 'text' as const, text: steerText },
            ]
          : result.nextMessage;
        currentPromptId = this.generateContinuationPromptId(initialPromptId);
      }
    } catch (error) {
      logger.debug(
        () =>
          `AgenticLoop.run error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      unsubscribe();
      this.isRunning = false;
      this.pendingSteer = [];
    }
  }

  /**
   * Executes a single turn: stream → schedule tools → await completion →
   * build response parts. Returns whether the loop should continue and the
   * next message to send (functionResponse parts) if so.
   */
  private async *runTurn(
    message: AgentMessageInput,
    signal: AbortSignal,
    promptId: string,
  ): AsyncGenerator<AgenticLoopEvent, TurnRunResult> {
    const toolCallRequests: ToolCallRequestInfo[] = [];
    const streamResult = yield* this.streamAndCollect(
      message,
      signal,
      promptId,
      toolCallRequests,
    );

    if (signal.aborted || !streamResult.shouldScheduleTools) {
      return {
        continueLoop: false,
        nextMessage: [],
        allowSteerContinuation: false,
      };
    }
    if (toolCallRequests.length === 0) {
      return {
        continueLoop: false,
        nextMessage: [],
        allowSteerContinuation: true,
      };
    }

    const dedupedRequests = deduplicateToolCallRequests(toolCallRequests);
    for (const request of dedupedRequests) {
      this.ownedToolCallIds.add(request.callId);
    }

    let completed: CompletedToolCall[] | null;
    try {
      const result = yield* this.scheduleAndAwait(dedupedRequests, signal);
      completed = result.completed;
    } finally {
      for (const request of dedupedRequests) {
        this.ownedToolCallIds.delete(request.callId);
      }
    }

    if (completed === null || completed.length === 0) {
      return {
        continueLoop: false,
        nextMessage: [],
        allowSteerContinuation: false,
      };
    }

    this.notifyAllToolCallsComplete(completed);
    yield { kind: 'tools_complete', completed };
    // Bun 1.3.14 does not unwrap a promised async-generator return value through yield*.
    const nextMessage = await this.buildNextMessage(completed);
    return { ...nextMessage, allowSteerContinuation: false };
  }

  /**
   * Forwards the completed-tool-calls batch to the caller's
   * {@link DisplayCallbacks.onAllToolCallsComplete} before the loop emits its
   * tools_complete event. Supports async callbacks: the
   * returned promise is NOT awaited (must not block the loop) — a rejection
   * handler is attached so async failures are logged and never surface as
   * unhandled rejections. Sync throws are caught and logged the same way.
   */
  private notifyAllToolCallsComplete(completed: CompletedToolCall[]): void {
    const cb = this.displayCallbacks?.onAllToolCallsComplete;
    if (cb === undefined) {
      return;
    }
    try {
      const r = cb(completed);
      if (r && typeof r.then === 'function') {
        void r.then(undefined, (error) => {
          logger.debug(
            () =>
              `displayCallbacks.onAllToolCallsComplete async rejection (swallowed): ${
                error instanceof Error ? error.message : String(error)
              }`,
          );
        });
      }
    } catch (error) {
      logger.debug(
        () =>
          `displayCallbacks.onAllToolCallsComplete threw (swallowed): ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  /** Streams one model turn, yielding stream events and collecting tool requests. */
  private async *streamAndCollect(
    message: AgentMessageInput,
    signal: AbortSignal,
    promptId: string,
    toolCallRequests: ToolCallRequestInfo[],
  ): AsyncGenerator<AgenticLoopEvent, StreamCollectionResult> {
    const stream = this.agentClient.sendMessageStream(
      message,
      signal,
      promptId,
    );
    let shouldScheduleTools = true;
    for await (const event of stream) {
      yield { kind: 'stream', event };
      if (event.type === AgentEventType.ToolCallRequest) {
        toolCallRequests.push(event.value);
      } else if (event.type === AgentEventType.Retry) {
        toolCallRequests.length = 0;
      } else if (isTerminalStreamOutcome(event.type)) {
        toolCallRequests.length = 0;
        shouldScheduleTools = false;
      }
    }
    return { shouldScheduleTools };
  }

  /**
   * @requirement REQ-LOOP-001
   * Schedules the tool requests, drains tool events live while schedule and
   * completion resolve, handles abort-driven cancellation, and disposes the
   * scheduler. Returns the completed tool calls (or null on abort/empty).
   */
  private async *scheduleAndAwait(
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ): AsyncGenerator<AgenticLoopEvent, TurnToolResult> {
    const queue = new AgenticEventQueue();
    const sessionId = this.schedulerSessionId;

    const { resolveCompletion, completionPromise } =
      createCompletionController();

    let acceptedToolUpdateSeen = false;
    const forwardingState = { active: true };

    const scheduler = await this.createSchedulerWithCallbacks(
      sessionId,
      queue,
      resolveCompletion,
      forwardingState,
      () => {
        acceptedToolUpdateSeen = true;
      },
    );

    const state: TurnState = { completionSettled: false };
    const completionTask = wrapCompletionTask(completionPromise, state);

    let cleanupAbortListener: () => void = () => {};
    const abortPromise = this.createAbortPromise(
      signal,
      (cleanup: () => void) => {
        cleanupAbortListener = cleanup;
      },
    );

    const scheduleTask = scheduler
      .schedule(requests, signal)
      .then(() => {
        if (!acceptedToolUpdateSeen) {
          resolveCompletion([]);
        }
      })
      .catch((error: unknown) => {
        logger.debug(
          () =>
            `scheduler.schedule rejected; ending tool turn: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
        resolveCompletion([]);
      });

    let normalExit = false;
    try {
      yield* this.drainWhileRunning(completionTask, state, queue, signal);

      if (signal.aborted) {
        scheduler.cancelAll();
        await Promise.race([scheduleTask, completionTask, abortPromise]);
        yield* flushBuffered(queue);
      } else {
        await scheduleTask;
      }

      const completed = await Promise.race([completionTask, abortPromise]);
      if (completed !== null && !signal.aborted) {
        queue.flushOutputOmissionNotices();
        yield* flushBuffered(queue);
      }
      normalExit = completed !== null && !signal.aborted;
      return { completed };
    } finally {
      if (!normalExit) {
        scheduler.cancelAll();
        await Promise.race([scheduleTask, completionTask, abortPromise]);
      }
      forwardingState.active = false;
      queue.close();
      cleanupAbortListener();
      this.config.disposeScheduler(sessionId);
    }
  }

  private createAbortPromise(
    signal: AbortSignal,
    registerCleanup: (cleanup: () => void) => void,
  ): Promise<null> {
    return new Promise<null>((resolve) => {
      if (signal.aborted) {
        resolve(null);
        return;
      }
      const onAbort = () => resolve(null);
      signal.addEventListener('abort', onAbort, { once: true });
      registerCleanup(() => signal.removeEventListener('abort', onAbort));
    });
  }

  private async createSchedulerWithCallbacks(
    sessionId: string,
    queue: AgenticEventQueue,
    resolveCompletion: (calls: CompletedToolCall[]) => void,
    forwardingState: { active: boolean },
    markAcceptedUpdate: () => void,
  ): Promise<ToolSchedulerContract> {
    const display = this.displayCallbacks;

    return this.config.getOrCreateScheduler(
      sessionId,
      {
        outputUpdateHandler: (callId, update) => {
          if (!forwardingState.active) {
            return;
          }
          if (update.mode === 'append') {
            queue.push({ kind: 'tool_output', callId, chunk: update.data });
          }
          display?.outputUpdateHandler?.(callId, update);
        },
        onToolCallsUpdate: (toolCalls) => {
          if (!forwardingState.active) {
            return;
          }
          if (toolCalls.length > 0) {
            markAcceptedUpdate();
          }
          queue.push({ kind: 'tool_update', toolCalls });
          if (toolCalls.some((tc) => tc.status === 'awaiting_approval')) {
            queue.push({ kind: 'awaiting_approval', toolCalls });
          }
          display?.onToolCallsUpdate?.(toolCalls);
        },
        onAllToolCallsComplete: async (completed) => {
          if (forwardingState.active) {
            queue.push({ kind: 'tool_update', toolCalls: [] });
            display?.onToolCallsUpdate?.([]);
          }
          resolveCompletion(completed);
        },
        getPreferredEditor: display?.getPreferredEditor ?? (() => undefined),
        onEditorOpen: display?.onEditorOpen ?? (() => {}),
        onEditorClose: display?.onEditorClose ?? (() => {}),
      },
      { interactiveMode: this.interactiveMode },
      { messageBus: this.messageBus },
    );
  }

  /**
   * Drains the queue until completion settles (or the signal aborts).
   * Scheduling finishing is NOT a stop condition: tool_update/tool_output
   * events can still arrive between schedule resolution and completion and
   * must be yielded. A final flush captures events buffered alongside the
   * completion signal.
   */
  private async *drainWhileRunning(
    completionTask: Promise<CompletedToolCall[] | null>,
    state: TurnState,
    queue: AgenticEventQueue,
    signal: AbortSignal,
  ): AsyncGenerator<AgenticLoopEvent> {
    while (!state.completionSettled && !signal.aborted) {
      await Promise.race([completionTask, queue.waitForNext(signal)]);
      yield* flushBuffered(queue);
    }
    yield* flushBuffered(queue);
  }

  /** Builds the next message (functionResponse parts) from completed tools. */
  private async buildNextMessage(completed: CompletedToolCall[]): Promise<{
    continueLoop: boolean;
    nextMessage: AgentMessageInput;
  }> {
    const { primaryTools } = classifyCompletedTools(completed);
    const agentTools = primaryTools.filter(
      (t) => t.request.isClientInitiated !== true,
    );
    if (agentTools.length === 0) {
      return { continueLoop: false, nextMessage: [] };
    }
    if (agentTools.every((tc) => tc.status === 'cancelled')) {
      // Await so the cancelled-tool history is persisted before the loop ends.
      await recordCancelledToolHistory(agentTools, this.agentClient);
      return { continueLoop: false, nextMessage: [] };
    }
    // A successful pause request (the pause tool) is a terminal signal: the
    // loop must stop so the agent returns control to the user. Without this,
    // the loop feeds the pause response back to the model and continues
    // indefinitely (issue #2653). In the CLI this is masked by the React UI
    // continuation gate, but ACP/Zed and other headless consumers have none.
    if (hasSuccessfulTodoPause(agentTools)) {
      // Eagerly persist tool history since there will be no next model turn
      // to carry the response parts naturally.
      await recordCompletedToolHistory(agentTools, this.agentClient);
      return { continueLoop: false, nextMessage: [] };
    }
    const responseParts = buildToolResponses(
      agentTools,
      this.config.getImagePayloadBudgetBytes(),
    );
    if (responseParts.length === 0) {
      return { continueLoop: false, nextMessage: [] };
    }
    return { continueLoop: true, nextMessage: responseParts };
  }
}

/** Yields all currently-buffered events without blocking. */
function* flushBuffered(queue: AgenticEventQueue): Generator<AgenticLoopEvent> {
  let event = queue.popBuffered();
  while (event !== undefined) {
    yield event;
    event = queue.popBuffered();
  }
}

/**
 * Returns true if any of the completed tool calls is a successful pause
 * (case-insensitive, no error). A failed pause must NOT terminate the loop,
 * matching TodoContinuationService.isSuccessfulTodoPauseResponse semantics.
 */
function hasSuccessfulTodoPause(tools: CompletedToolCall[]): boolean {
  return tools.some(
    (tc) =>
      tc.request.name.toLowerCase() === 'todo_pause' &&
      tc.status === 'success' &&
      tc.response.error === undefined &&
      tc.response.errorType === undefined,
  );
}
