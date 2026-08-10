/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useAgentEventStream — the CLI's consumer of the public Agent facade.
 * The Agent owns send→stream→schedule→execute→feed-back→repeat; multi-turn
 * continuation is driven entirely by the Agent, not the CLI.
 *
 * Responsibilities of this hook:
 *  - Register display + editor callbacks on the Agent (via agent.tools.
 *    setDisplayCallbacks / setEditorCallbacks) using the latest-ref pattern
 *    so stable wrappers always forward to the latest caller callbacks.
 *  - Expose `runStream(message, signal, promptId)` that iterates the Agent's
 *    public event stream (agent.stream()) and routes each AgentEvent to
 *    React state via the agentEventDispatcher.
 *  - The onAllToolCallsComplete display callback handles tool-group display,
 *    memory refresh, pause-task, and display-clearing for external tools.
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import type {
  Agent,
  AgentEvent,
  AgentInput,
} from '@vybestack/llxprt-code-agents';
import type {
  LiveOutputUpdate,
  CompletedToolCall,
  EditorType,
  ToolCall,
  AgentRequestInput,
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { UseHistoryManagerReturn } from '../useHistoryManager.js';
import { mapToDisplay as mapTrackedToolCallsToDisplay } from '../toolMapping.js';
import {
  processMemoryToolResults,
  classifyCompletedTools,
} from './toolCompletionHandler.js';

const logger = DebugLogger.getLogger('llxprt:cli:agent-event-stream');

/**
 * Package-private monotonic clock seam for default-off testing (P07). Defaults
 * to `performance.now`; tests inject a counting clock to prove the
 * absent-observer path performs NO timing work. NOT exported via the package
 * barrel (index.ts) — tests deep-import it directly.
 */
let monotonicClock: () => number = () => performance.now();

/**
 * @internal Package-private test seam for the event-dispatch monotonic clock.
 * NOT part of the package barrel/API; pass null to restore the default clock.
 */
export function __setMonotonicClockForTesting(
  clock: (() => number) | null,
): void {
  monotonicClock = clock ?? (() => performance.now());
}

/** Routes a single public AgentEvent into React state. */
export type AgentEventRouter = (
  event: AgentEvent,
  userMessageTimestamp: number,
  signal: AbortSignal,
) => void;

export interface UseAgentEventStreamArgs {
  agent: Agent;
  /** Adds a history item (used for tool-completion display). */
  addItem: UseHistoryManagerReturn['addItem'];
  /**
   * Ref to a function that routes a public AgentEvent to the existing React
   * state handlers. Held as a ref to break the circular dependency.
   */
  processAgentEventRef: React.MutableRefObject<AgentEventRouter | null>;
  /**
   * Flushes any pending AI content into history. Called before tool
   * results are committed so content-above-tools ordering is preserved.
   */
  flushPendingHistoryItem: (timestamp: number) => void;
  /** Clears the pending-history-item reference after a flush. */
  clearPendingHistoryItem: () => void;
  /** Refreshes in-memory data after a successful save_memory. */
  performMemoryRefresh: () => Promise<void>;
  /**
   * Marks the given tool callIds as cleared from the React display state.
   */
  markToolsAsDisplayCleared?: (callIds: string[]) => void;
  /** Display callbacks for tool-call display state. */
  onToolCallsUpdate?: (toolCalls: ToolCall[]) => void;
  outputUpdateHandler?: (callId: string, update: LiveOutputUpdate) => void;
  getPreferredEditor?: () => EditorType | undefined;
  onEditorOpen?: () => void;
  onEditorClose?: () => void;
  /**
   * Optional perf callback invoked DIRECTLY OUTSIDE the ordinary
   * processAgentEvent try/catch for EACH observed AgentEvent, carrying the
   * turn's AbortSignal so measurements route to the correct operation (not the
   * "current active op" by position). This performs live phase tracking
   * (tool-status → tool/approval states, provider-abort → API evidence) and
   * accumulates stream_handler_ms.
   *
   * D8: because this is invoked OUTSIDE the generic catch-and-log boundary, a
   * perf observer/programming error propagates and REJECTS the stream.
   * Ordinary event-handler errors remain caught/logged so the stream
   * continues. When undefined (perf disabled), this is a no-op.
   */
  onAgentEventObserved?: (
    event: AgentEvent,
    signal: AbortSignal,
    syncHandlerMs: number,
  ) => void;
}

export interface UseAgentEventStreamReturn {
  /**
   * Iterates the Agent's public event stream, routing events to React state.
   * Continuation is driven by the Agent; the CLI does not re-submit.
   */
  runStream: (
    message: AgentRequestInput,
    signal: AbortSignal,
    promptId: string,
  ) => Promise<void>;
}

/**
 * Processes a tools_complete callback: adds the tool-group display item and
 * refreshes memory if a save_memory succeeded. The Agent's loop has ALREADY
 * recorded the completed calls into chat history — do NOT call
 * recordCompletedToolCalls here.
 */
function handleToolsComplete(
  completed: readonly CompletedToolCall[],
  args: UseAgentEventStreamArgs,
  processedMemoryTools: Set<string>,
  userMessageTimestamp: number,
): void {
  // Flush any pending AI content BEFORE the tool_group so content-above-
  // tools ordering is preserved.
  args.flushPendingHistoryItem(userMessageTimestamp);
  args.clearPendingHistoryItem();

  const completedArr = [...completed];
  args.addItem(
    mapTrackedToolCallsToDisplay(completedArr),
    userMessageTimestamp,
  );
  const { primaryTools, externalTools } = classifyCompletedTools(completedArr);
  const memoryRef = { current: processedMemoryTools };
  processMemoryToolResults(primaryTools, memoryRef, args.performMemoryRefresh);

  if (externalTools.length > 0) {
    args.markToolsAsDisplayCleared?.(
      externalTools.map((tc) => tc.request.callId),
    );
  }
}

export function useAgentEventStream(
  args: UseAgentEventStreamArgs,
): UseAgentEventStreamReturn {
  const processedMemoryTools = useMemo(() => new Set<string>(), []);

  // Latest-ref pattern: a single ref holds the latest args so stable wrapper
  // callbacks (registered ONCE per agent instance) always forward to the
  // latest caller callback.
  const latestArgs = useRef(args);
  latestArgs.current = args;

  // The timestamp captured at the start of the current (or most-recent)
  // runStream call. Used by onAllToolCallsComplete so tool-completion display
  // items are stamped with the turn's invocation time (matching the deleted
  // useAgenticLoop's runLoop-timestamp semantics), NOT Date.now() at callback
  // fire time. Falls back to Date.now() when no run is active.
  const currentTurnTimestampRef = useRef<number | null>(null);

  // Register display + editor callbacks on the Agent. Re-register only when
  // the agent instance changes. Cleanup clears the registration so a stale
  // unmounted hook's closures cannot linger on the long-lived Agent.
  useEffect(() => {
    const agent = args.agent;
    agent.tools.setDisplayCallbacks({
      onToolCallsUpdate: (toolCalls) =>
        latestArgs.current.onToolCallsUpdate?.(toolCalls),
      outputUpdateHandler: (callId, update) =>
        latestArgs.current.outputUpdateHandler?.(callId, update),
      onAllToolCallsComplete: (completed) => {
        const userMessageTimestamp =
          currentTurnTimestampRef.current ?? Date.now();
        handleToolsComplete(
          completed,
          latestArgs.current,
          processedMemoryTools,
          userMessageTimestamp,
        );
      },
    });
    agent.tools.setEditorCallbacks({
      getPreferredEditor: () => latestArgs.current.getPreferredEditor?.(),
      onEditorOpen: () => latestArgs.current.onEditorOpen?.(),
      onEditorClose: () => latestArgs.current.onEditorClose?.(),
    });
    return () => {
      agent.tools.setDisplayCallbacks({});
      agent.tools.setEditorCallbacks({});
    };
  }, [args.agent, processedMemoryTools]);

  // Holds the in-flight runStream promise so overlapping calls can be
  // serialized (see runStream for details).
  const inflightRunRef = useRef<Promise<void> | null>(null);

  const runStream = useCallback(
    async (
      message: AgentRequestInput,
      signal: AbortSignal,
      promptId: string,
    ): Promise<void> => {
      // Serialize overlapping runStream calls: await any in-flight previous
      // run — swallowing its (expected) cancellation error — before starting
      // the next. This mirrors the pre-migration useAgenticLoop semantics
      // (HEAD parity). A previous run that never settles would delay the
      // next run; aborting the previous signal is expected to settle it via
      // the loop's run() finally block + abort promise, so the chain never
      // deadlocks under normal abort usage.
      const previous = inflightRunRef.current ?? Promise.resolve();
      // Note: the .catch below only handles errors from the PREVIOUS run (the
      // `previous` promise). Errors from the CURRENT run propagate to the
      // caller via `await currentRun` below.
      const currentRun = previous
        .catch((error) => {
          // Swallow the expected AbortError from the previous run, but log
          // any non-abort error so it is not silently lost.
          if (error?.name !== 'AbortError') {
            logger.error('Previous agent stream run failed:', error);
          }
        })
        .then(() => {
          // Runs are serialized, so at this point the previous run has settled.
          // Capture the turn timestamp HERE — after the previous run resolved —
          // so a late tools-complete callback from the previous run cannot be
          // stamped with the new turn's timestamp. The same value is used for
          // both the ref (consulted by onAllToolCallsComplete) and
          // iterateAgentStream's userMessageTimestamp.
          const userMessageTimestamp = Date.now();
          currentTurnTimestampRef.current = userMessageTimestamp;
          // Clear the memory-tool dedup set at the start of each serialized run.
          // CallIds are globally unique, so the set only exists to prevent
          // double-refresh within a single completion batch — no cross-run dedup
          // semantics are needed (verified in toolCompletionHandler.ts).
          processedMemoryTools.clear();
          return iterateAgentStream(
            args.agent,
            message,
            signal,
            promptId,
            latestArgs.current,
            userMessageTimestamp,
          );
        });
      inflightRunRef.current = currentRun;
      try {
        await currentRun;
      } finally {
        if (inflightRunRef.current === currentRun) {
          inflightRunRef.current = null;
        }
      }
    },
    [args.agent, processedMemoryTools],
  );

  return { runStream };
}

/**
 * Iterates the Agent's event generator, routing each event until the stream
 * ends or the signal aborts.
 */
/**
 * Normalizes an AgentRequestInput (neutral AgentMessageInput) to AgentInput
 * without type escapes:
 * - string passes through;
 * - ContentBlock[] passes through directly;
 * - IContent passes through directly (preserving speaker);
 * - IContent[] passes through directly (preserving speaker and turn
 *   boundaries — no flattening, so the agent loop sees each turn as a
 *   distinct IContent entry, not a single flat block array).
 */
function toAgentInput(message: AgentRequestInput): AgentInput {
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return [];
    }
    const first = message[0];
    if (typeof first === 'object' && 'speaker' in first && 'blocks' in first) {
      // IContent[] — pass through directly to preserve turn boundaries.
      return message as IContent[];
    }
    // ContentBlock[] — pass through directly.
    return message as ContentBlock[];
  }
  // Single IContent — pass through directly to preserve speaker.
  return message;
}

function iterateAgentStream(
  agent: Agent,
  message: AgentRequestInput,
  signal: AbortSignal,
  promptId: string,
  args: UseAgentEventStreamArgs,
  userMessageTimestamp: number,
): Promise<void> {
  return (async () => {
    const input = toAgentInput(message);
    const iterator = agent.stream(input, { signal, promptId });
    const observer = args.onAgentEventObserved;
    // Shared dispatch-with-catch: one bad event must not abort the entire
    // stream. Extracted so both the observer-absent and observer-present
    // branches use identical dispatch behavior.
    const dispatchEvent = (event: AgentEvent): void => {
      try {
        args.processAgentEventRef.current?.(
          event,
          userMessageTimestamp,
          signal,
        );
      } catch (error) {
        // One bad event must not abort the entire stream.
        logger.error('Error processing agent event:', error);
      }
    };
    for await (const event of iterator) {
      if (signal.aborted) break;
      if (observer === undefined) {
        // Default-off: no perf observer means NO timing calls and NO sample
        // allocation. The ordinary handler dispatch/catch behavior is preserved
        // so one bad event never aborts the stream.
        dispatchEvent(event);
      } else {
        // Measure the synchronous dispatch, then invoke the observer OUTSIDE
        // the generic catch-and-log boundary (D8: a perf-callback throw rejects
        // the stream / fail-fast). Ordinary handler throws were already
        // caught/logged inside dispatchEvent so the stream continues.
        const handlerStart = monotonicClock();
        dispatchEvent(event);
        const handlerMs = monotonicClock() - handlerStart;
        observer(event, signal, handlerMs);
      }
    }
  })();
}
