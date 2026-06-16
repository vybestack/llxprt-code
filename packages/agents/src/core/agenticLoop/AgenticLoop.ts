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
import type { PartListUnion } from '@google/genai';
import {
  GeminiEventType,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgenticLoopEvent, AgenticLoopOptions } from './types.js';
import {
  buildToolResponses,
  classifyCompletedTools,
  recordCancelledToolHistory,
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

function isTerminalStreamOutcome(type: GeminiEventType): boolean {
  return (
    type === GeminiEventType.Error ||
    type === GeminiEventType.StreamIdleTimeout ||
    type === GeminiEventType.UserCancelled ||
    type === GeminiEventType.LoopDetected
  );
}

/**
 * A bounded buffer the loop's scheduler callbacks push events into and `run`
 * drains. Resolves the tension between callback-driven scheduler events and
 * the generator-based loop body.
 */
class EventQueue {
  private readonly buffered: AgenticLoopEvent[] = [];
  private resolveWait: (() => void) | null = null;
  private closed = false;

  push(event: AgenticLoopEvent): void {
    if (this.closed) {
      return;
    }
    this.buffered.push(event);
    this.resolveWait?.();
    this.resolveWait = null;
  }

  popBuffered(): AgenticLoopEvent | undefined {
    return this.buffered.shift();
  }

  waitForNext(signal: AbortSignal): Promise<void> {
    if (this.buffered.length > 0 || this.closed || signal.aborted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        this.resolveWait = null;
        resolve();
      };
      const onAbort = () => {
        settle();
      };
      this.resolveWait = () => {
        settle();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        settle();
      }
    });
  }

  close(): void {
    this.closed = true;
    this.resolveWait?.();
    this.resolveWait = null;
  }
}

/** A mutable holder so promise callbacks can communicate state to the loop. */
interface TurnState {
  completionSettled: boolean;
}

/** Result of scheduling+awaiting tools for one turn. */
interface TurnToolResult {
  completed: CompletedToolCall[] | null;
  events: EventQueue;
}

interface StreamCollectionResult {
  shouldScheduleTools: boolean;
}

/**
 * @requirement REQ-LOOP-001
 * Engine-owned multi-turn agentic loop. Construct with
 * {@link AgenticLoopOptions} and iterate `run(message, signal)` to receive a
 * flat {@link AgenticLoopEvent} stream.
 */
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
    return bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        const callId = request.toolCall.id;
        if (callId === undefined || !this.ownedToolCallIds.has(callId)) {
          return;
        }
        void handler(request)
          .then((result) => {
            bus.respondToConfirmation(
              request.correlationId,
              result.outcome,
              result.payload,
            );
          })
          .catch((error: unknown) => {
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
    message: PartListUnion,
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
        if (!result.continueLoop) {
          return;
        }
        currentMessage = result.nextMessage;
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
    }
  }

  /**
   * Executes a single turn: stream → schedule tools → await completion →
   * build response parts. Returns whether the loop should continue and the
   * next message to send (functionResponse parts) if so.
   */
  private async *runTurn(
    message: PartListUnion,
    signal: AbortSignal,
    promptId: string,
  ): AsyncGenerator<
    AgenticLoopEvent,
    { continueLoop: boolean; nextMessage: PartListUnion }
  > {
    const toolCallRequests: ToolCallRequestInfo[] = [];
    const streamResult = yield* this.streamAndCollect(
      message,
      signal,
      promptId,
      toolCallRequests,
    );

    if (
      signal.aborted ||
      !streamResult.shouldScheduleTools ||
      toolCallRequests.length === 0
    ) {
      return { continueLoop: false, nextMessage: [] };
    }

    const dedupedRequests = deduplicateToolCallRequests(toolCallRequests);
    for (const request of dedupedRequests) {
      this.ownedToolCallIds.add(request.callId);
    }

    let completed: CompletedToolCall[] | null;
    try {
      const result = yield* this.scheduleAndAwait(dedupedRequests, signal);
      completed = result.completed;
      void result.events;
    } finally {
      for (const request of dedupedRequests) {
        this.ownedToolCallIds.delete(request.callId);
      }
    }

    if (completed === null || completed.length === 0) {
      return { continueLoop: false, nextMessage: [] };
    }

    this.recordCompletedToolCalls(completed);
    yield { kind: 'tools_complete', completed };
    return this.buildNextMessage(completed);
  }

  private recordCompletedToolCalls(completed: CompletedToolCall[]): void {
    try {
      const currentModel =
        this.agentClient.getCurrentSequenceModel() ?? this.config.getModel();
      this.agentClient
        .getChat()
        .recordCompletedToolCalls(currentModel, completed);
    } catch {
      // History persistence is best-effort; loop continuation uses the
      // functionResponse parts built from the completed calls directly.
    }
  }

  /** Streams one model turn, yielding stream events and collecting tool requests. */
  private async *streamAndCollect(
    message: PartListUnion,
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
      if (event.type === GeminiEventType.ToolCallRequest) {
        toolCallRequests.push(event.value);
        continue;
      }
      if (isTerminalStreamOutcome(event.type)) {
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
  // eslint-disable-next-line max-lines-per-function -- This generator keeps scheduler lifecycle, live event draining, and teardown in one atomic control flow.
  private async *scheduleAndAwait(
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ): AsyncGenerator<AgenticLoopEvent, TurnToolResult> {
    const queue = new EventQueue();
    // Use this loop's isolated scheduler key (NOT config.getSessionId()) so the
    // transient per-turn scheduler never clobbers the CLI main scheduler's
    // callbacks. See the `schedulerSessionId` field doc.
    const sessionId = this.schedulerSessionId;

    let completionResolver: ((calls: CompletedToolCall[]) => void) | null =
      null;
    let acceptedToolUpdateSeen = false;
    let completionResolved = false;
    const resolveCompletion = (calls: CompletedToolCall[]) => {
      if (completionResolved) {
        return;
      }
      completionResolved = true;
      completionResolver?.(calls);
    };
    const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
      completionResolver = resolve;
    });

    const display = this.displayCallbacks;
    let forwardingActive = true;

    const scheduler = await this.config.getOrCreateScheduler(
      sessionId,
      {
        outputUpdateHandler: (callId, chunk) => {
          if (!forwardingActive) {
            return;
          }
          if (typeof chunk === 'string') {
            queue.push({ kind: 'tool_output', callId, chunk });
          }
          display?.outputUpdateHandler?.(callId, chunk);
        },
        onToolCallsUpdate: (toolCalls) => {
          if (!forwardingActive) {
            return;
          }
          if (toolCalls.length > 0) {
            acceptedToolUpdateSeen = true;
          }
          queue.push({ kind: 'tool_update', toolCalls });
          if (toolCalls.some((tc) => tc.status === 'awaiting_approval')) {
            queue.push({ kind: 'awaiting_approval', toolCalls });
          }
          display?.onToolCallsUpdate?.(toolCalls);
        },
        onAllToolCallsComplete: async (completed) => {
          // CoreToolScheduler clears its internal toolCalls and notifies after
          // this callback returns. The loop resolves completion from this
          // callback, so mirror the final empty update first to keep display
          // state from racing behind continuation.
          if (forwardingActive) {
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

    const state: TurnState = { completionSettled: false };
    const completionTask: Promise<CompletedToolCall[] | null> =
      completionPromise
        .then((c) => c)
        .catch(() => null)
        .finally(() => {
          state.completionSettled = true;
        });

    // Resolves promptly when the signal aborts so the loop never blocks on a
    // completion that may never arrive — e.g. an abort before any tool
    // registers, where `cancelAll()` does not fire `onAllToolCallsComplete`.
    // `cleanupAbortListener` always points at a callable (a no-op when the
    // signal was already aborted) so teardown is unconditional.
    let cleanupAbortListener: () => void = () => {};
    const abortPromise = new Promise<null>((resolve) => {
      if (signal.aborted) {
        resolve(null);
        return;
      }
      const onAbort = () => resolve(null);
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupAbortListener = () => signal.removeEventListener('abort', onAbort);
    });

    // If scheduling returns without accepting work (e.g. validation filters all
    // calls) or rejects before any tool registers, `onAllToolCallsComplete` will
    // not fire. Resolve completion with an empty batch so the loop terminates
    // gracefully instead of hanging. CoreToolScheduler awaits its final
    // completion notification before schedule() resolves, so this fallback only
    // wins for no-op/error scheduling paths.
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

    yield* this.drainWhileRunning(completionTask, state, queue, signal);

    // On abort during scheduling/execution, cancel in-flight tools.
    if (signal.aborted) {
      scheduler.cancelAll();
      await Promise.race([scheduleTask, completionTask]);
    } else {
      await scheduleTask;
    }
    forwardingActive = false;
    queue.close();
    this.config.disposeScheduler(sessionId);

    const completed = await Promise.race([completionTask, abortPromise]);
    cleanupAbortListener();
    return { completed, events: queue };
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
    queue: EventQueue,
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
    nextMessage: PartListUnion;
  }> {
    const { primaryTools } = classifyCompletedTools(completed);
    const geminiTools = primaryTools.filter(
      (t) => t.request.isClientInitiated !== true,
    );
    if (geminiTools.length === 0) {
      return { continueLoop: false, nextMessage: [] };
    }
    if (geminiTools.every((tc) => tc.status === 'cancelled')) {
      // Await so the cancelled-tool history is persisted before the loop ends.
      await recordCancelledToolHistory(geminiTools, this.agentClient);
      return { continueLoop: false, nextMessage: [] };
    }
    const responseParts = buildToolResponses(geminiTools);
    if (responseParts.length === 0) {
      return { continueLoop: false, nextMessage: [] };
    }
    return { continueLoop: true, nextMessage: responseParts };
  }
}

/** Yields all currently-buffered events without blocking. */
function* flushBuffered(queue: EventQueue): Generator<AgenticLoopEvent> {
  let event = queue.popBuffered();
  while (event !== undefined) {
    yield event;
    event = queue.popBuffered();
  }
}
