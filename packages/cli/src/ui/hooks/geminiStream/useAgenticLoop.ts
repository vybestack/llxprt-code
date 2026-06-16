/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useAgenticLoop — the CLI's single consumer of the engine-owned AgenticLoop.
 * The loop owns send→stream→schedule→execute→feed-back→repeat; multi-turn
 * continuation is driven entirely by the engine, not the CLI.
 *
 * Responsibilities of this hook:
 *  - Hold a stable AgenticLoop instance (constructed by the orchestrator with
 *    the live agentClient + the CLI's display callbacks injected via
 *    `displayCallbacks` so the loop's scheduler drives the SAME React display
 *    state the CLI used to drive itself).
 *  - Expose `runLoop(message, signal, promptId)` that iterates the loop's flat
 *    event stream and routes each AgenticLoopEvent to the React state updates
 *    the CLI performs today:
 *      • stream  → the existing per-event stream handlers (content/thought/
 *                  error/finished/...), reusing useStreamEventHandlers' logic
 *                  WITHOUT the post-stream tool scheduling (the loop schedules).
 *      • tools_complete → addItem(display) + recordCompletedToolCalls +
 *                  processMemoryToolResults + onTodoPause.
 *  - Manage NOTHING about continuation re-entry — that is the loop's job.
 *
 * tool_update / tool_output / awaiting_approval events are already forwarded
 * to the caller via the loop's displayCallbacks (onToolCallsUpdate /
 * outputUpdateHandler), so the hook does not re-handle them here.
 */

import { useCallback, useMemo, useRef } from 'react';
import { type PartListUnion } from '@google/genai';
import {
  AgenticLoop,
  type AgenticLoopEvent,
  type ApprovalHandler,
} from '@vybestack/llxprt-code-agents';
import type {
  AgentClientContract,
  AnsiOutput,
  CompletedToolCall,
  Config,
  EditorType,
  OutputUpdateHandler,
  ServerGeminiStreamEvent,
  ToolCall,
  ToolCallsUpdateHandler,
} from '@vybestack/llxprt-code-core';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { UseHistoryManagerReturn } from '../useHistoryManager.js';
import { mapToDisplay as mapTrackedToolCallsToDisplay } from '../toolMapping.js';
import {
  processMemoryToolResults,
  classifyCompletedTools,
} from './toolCompletionHandler.js';

/**
 * Caller-provided UI passthrough callbacks forwarded to the loop's scheduler.
 * Mirrors the engine DisplayCallbacks interface.
 */
export interface DisplayCallbacks {
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  outputUpdateHandler?: OutputUpdateHandler;
  getPreferredEditor?: () => EditorType | undefined;
  onEditorOpen?: () => void;
  onEditorClose?: () => void;
}

/** Streams a single ServerGeminiStreamEvent into React state. */
export type StreamEventRouter = (
  event: ServerGeminiStreamEvent,
  userMessageTimestamp: number,
) => void;

export interface UseAgenticLoopArgs {
  config: Config;
  agentClient: AgentClientContract;
  /**
   * The MessageBus used by the loop's ConfirmationCoordinator. When undefined
   * (headless/test contexts), a default bus is constructed so the loop can run.
   */
  messageBus: MessageBus | undefined;
  /** Whether the loop's scheduler runs in interactive mode. */
  interactiveMode?: boolean;
  /** Optional approval handler for ASK_USER policy resolution. */
  approvalHandler?: ApprovalHandler;
  /** Adds a history item (used for tool-completion display). */
  addItem: UseHistoryManagerReturn['addItem'];
  /**
   * Ref to a function that routes a model stream event to the existing React
   * state handlers. Held as a ref (not a direct callback) to break the
   * circular dependency: useStreamEventHandlers is created inside
   * useSubmitQuery, which itself needs runLoop from this hook. The ref is
   * populated after the first render and read at call time.
   */
  processStreamEventRef: React.MutableRefObject<StreamEventRouter | null>;
  /**
   * Flushes any pending gemini content into history. Called before tool
   * results are committed so content-above-tools ordering is preserved.
   */
  flushPendingHistoryItem: (timestamp: number) => void;
  /** Clears the pending-history-item reference after a flush. */
  clearPendingHistoryItem: () => void;
  /** Refreshes in-memory data after a successful save_memory. */
  performMemoryRefresh: () => Promise<void>;
  /** Invoked when the pause tool succeeds. */
  onTodoPause?: () => void;
  /**
   * Marks the given tool callIds as submitted so the React display state clears
   * them. Used for external (subagent) tools whose results are owned by the
   * subagent flow, not the primary loop continuation. Display-only.
   */
  markToolsAsSubmitted?: (callIds: string[]) => void;
  /** Display callbacks forwarded into the loop's scheduler. */
  onToolCallsUpdate?: (toolCalls: ToolCall[]) => void;
  outputUpdateHandler?: (callId: string, chunk: string | AnsiOutput) => void;
  getPreferredEditor?: () => EditorType | undefined;
  onEditorOpen?: () => void;
  onEditorClose?: () => void;
}

export interface UseAgenticLoopReturn {
  /**
   * Iterates the engine-owned AgenticLoop, routing events to React state.
   * Continuation is driven by the loop; the CLI does not re-submit.
   */
  runLoop: (
    message: PartListUnion,
    signal: AbortSignal,
    promptId: string,
  ) => Promise<void>;
  /** The display callbacks forwarded into the loop's scheduler. */
  displayCallbacks: DisplayCallbacks;
  /** The underlying AgenticLoop instance (for advanced callers). */
  loop: AgenticLoop;
}

/**
 * Partitions CompletedToolCall[] into primary-agent and external (subagent)
 * tools, mirroring the CLI's classifyCompletedTools so memory-refresh +
 * todoPause logic operates on the primary partition and subagent display
 * clearing operates on the external partition.
 */
function partitionCompletedTools(completed: CompletedToolCall[]): {
  primaryTools: CompletedToolCall[];
  externalTools: CompletedToolCall[];
} {
  return classifyCompletedTools(completed);
}

/**
 * Processes a tools_complete event: adds the tool-group display item, refreshes
 * memory if a save_memory succeeded, and fires onTodoPause if a todo_pause
 * succeeded. Each of these fires exactly once per completion batch (the loop
 * emits tools_complete once per turn).
 */
function handleToolsComplete(
  completed: CompletedToolCall[],
  args: UseAgenticLoopArgs,
  processedMemoryTools: Set<string>,
  userMessageTimestamp: number,
): void {
  // Flush any pending gemini content BEFORE the tool_group so content-above-
  // tools ordering is preserved (parity with the old scheduleDedupedToolCalls
  // flush that ran before tool scheduling).
  args.flushPendingHistoryItem(userMessageTimestamp);
  args.clearPendingHistoryItem();

  args.addItem(mapTrackedToolCallsToDisplay(completed), userMessageTimestamp);
  const { primaryTools, externalTools } = partitionCompletedTools(completed);
  if (
    primaryTools.some(
      (tc) => tc.request.name === 'todo_pause' && tc.status === 'success',
    )
  ) {
    args.onTodoPause?.();
  }
  const memoryRef = { current: processedMemoryTools };
  processMemoryToolResults(primaryTools, memoryRef, args.performMemoryRefresh);

  // Clear external (subagent) tools from the React display state. Their results
  // are owned by the subagent flow, not the primary loop continuation, so the
  // display must mark them submitted to remove them from the pending view.
  if (externalTools.length > 0) {
    args.markToolsAsSubmitted?.(externalTools.map((tc) => tc.request.callId));
  }
}

export function useAgenticLoop(args: UseAgenticLoopArgs): UseAgenticLoopReturn {
  const processedMemoryTools = useMemo(() => new Set<string>(), []);

  // The loop instance must stay stable across renders (recreating it would
  // tear down an in-flight turn). But the CLI's display callbacks are recreated
  // on most renders. We therefore wire STABLE wrapper callbacks into the loop
  // and forward each invocation to the LATEST caller callback via a ref that is
  // kept current on every render. This gives a stable loop that always calls
  // up-to-date display callbacks.
  const latestCallbacks = useRef<DisplayCallbacks>({});
  latestCallbacks.current = {
    onToolCallsUpdate: args.onToolCallsUpdate,
    outputUpdateHandler: args.outputUpdateHandler,
    getPreferredEditor: args.getPreferredEditor,
    onEditorOpen: args.onEditorOpen,
    onEditorClose: args.onEditorClose,
  };

  const displayCallbacks = useMemo<DisplayCallbacks>(
    () => ({
      onToolCallsUpdate: (toolCalls) =>
        latestCallbacks.current.onToolCallsUpdate?.(toolCalls),
      outputUpdateHandler: (callId, chunk) =>
        latestCallbacks.current.outputUpdateHandler?.(callId, chunk),
      getPreferredEditor: () => latestCallbacks.current.getPreferredEditor?.(),
      onEditorOpen: () => latestCallbacks.current.onEditorOpen?.(),
      onEditorClose: () => latestCallbacks.current.onEditorClose?.(),
    }),
    [],
  );

  // Construct the loop once per (agentClient, config, messageBus,
  // interactiveMode, approvalHandler, displayCallbacks) tuple. Every entry is a
  // stable reference (displayCallbacks is memoized with an empty dep array and
  // forwards to the latest callbacks via ref), so a parent re-render does not
  // recreate the loop yet the loop always calls current display callbacks.
  const loop = useMemo(
    () =>
      new AgenticLoop({
        agentClient: args.agentClient,
        config: args.config,
        messageBus: args.messageBus ?? new MessageBus(),
        interactiveMode: args.interactiveMode ?? false,
        approvalHandler: args.approvalHandler,
        displayCallbacks,
      }),
    [
      args.agentClient,
      args.config,
      args.messageBus,
      args.interactiveMode,
      args.approvalHandler,
      displayCallbacks,
    ],
  );

  const runLoop = useCallback(
    async (
      message: PartListUnion,
      signal: AbortSignal,
      promptId: string,
    ): Promise<void> => {
      const userMessageTimestamp = Date.now();
      const iterator = loop.run(message, signal, promptId);
      for await (const event of iterator) {
        if (signal.aborted) break;
        routeLoopEvent(event, args, userMessageTimestamp, processedMemoryTools);
      }
    },
    [loop, args, processedMemoryTools],
  );

  return { runLoop, displayCallbacks, loop };
}

/** Routes a single AgenticLoopEvent to the appropriate React state update. */
function routeLoopEvent(
  event: AgenticLoopEvent,
  args: UseAgenticLoopArgs,
  userMessageTimestamp: number,
  processedMemoryTools: Set<string>,
): void {
  switch (event.kind) {
    case 'stream':
      args.processStreamEventRef.current?.(event.event, userMessageTimestamp);
      return;
    case 'tools_complete':
      handleToolsComplete(
        event.completed,
        args,
        processedMemoryTools,
        userMessageTimestamp,
      );
      return;
    case 'tool_update':
    case 'tool_output':
    case 'awaiting_approval':
      // Already forwarded to the caller via the loop's displayCallbacks.
      return;
    default:
      return;
  }
}
