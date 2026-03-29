/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useToolCompletionHandler — extracts the handleCompletedTools callback and its
 * associated refs and effects from the orchestrator useGeminiStream hook.
 *
 * Manages the tool completion → continuation query lifecycle:
 *   - Queues completions while a stream is active (isResponding=true)
 *   - Processes queued completions when the stream ends
 *   - Handles cancelled turns, external agents, client-initiated tools,
 *     memory refreshes, and normal continuation queries
 */

import { useRef, useCallback, useEffect } from 'react';
import {
  GeminiClient,
  DEFAULT_AGENT_ID,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import type { Part, PartListUnion } from '@google/genai';
import {
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedCancelledToolCall,
} from '../useReactToolScheduler.js';
import { splitPartsByRole } from './streamUtils.js';

const geminiStreamLogger = new DebugLogger('llxprt:ui:gemini-stream');

// ─── Micro-helpers (pure transforms — no React hooks, no side effects) ─────────

/**
 * Splits completed tool calls into primary (DEFAULT_AGENT_ID) and external
 * (subagent) lists, filtering to only those with valid responseParts.
 */
export function classifyCompletedTools(tools: TrackedToolCall[]): {
  primaryTools: Array<TrackedCompletedToolCall | TrackedCancelledToolCall>;
  externalTools: Array<TrackedCompletedToolCall | TrackedCancelledToolCall>;
} {
  const completedAndReady = tools.filter(
    (tc): tc is TrackedCompletedToolCall | TrackedCancelledToolCall => {
      const isTerminalState =
        tc.status === 'success' ||
        tc.status === 'error' ||
        tc.status === 'cancelled';
      if (!isTerminalState) return false;
      return (
        (tc as TrackedCompletedToolCall | TrackedCancelledToolCall).response
          ?.responseParts !== undefined
      );
    },
  );

  const primary: Array<TrackedCompletedToolCall | TrackedCancelledToolCall> =
    [];
  const external: Array<TrackedCompletedToolCall | TrackedCancelledToolCall> =
    [];

  for (const toolCall of completedAndReady) {
    const agentId = toolCall.request.agentId ?? DEFAULT_AGENT_ID;
    if (agentId === DEFAULT_AGENT_ID) {
      primary.push(toolCall);
    } else {
      external.push(toolCall);
    }
  }

  return { primaryTools: primary, externalTools: external };
}

/**
 * Builds the list of functionResponse parts to send to Gemini.
 * Filters out functionCall parts (already in history from the assistant turn).
 */
export function buildToolResponses(
  geminiTools: Array<TrackedCompletedToolCall | TrackedCancelledToolCall>,
): Part[] {
  return geminiTools.flatMap((toolCall) =>
    toolCall.response.responseParts.filter(
      (part) => !(part && typeof part === 'object' && 'functionCall' in part),
    ),
  );
}

/**
 * Records cancelled tool history and marks as submitted.
 * Used for both turn-cancelled and all-tools-cancelled branches.
 */
export function recordCancelledToolHistory(
  tools: Array<TrackedCompletedToolCall | TrackedCancelledToolCall>,
  geminiClient: GeminiClient,
  markToolsAsSubmitted: (callIds: string[]) => void,
): void {
  const allParts = tools.flatMap((tc) => tc.response.responseParts);
  const { functionCalls, functionResponses, otherParts } =
    splitPartsByRole(allParts);

  if (functionCalls.length > 0) {
    void geminiClient.addHistory({ role: 'model', parts: functionCalls });
  }
  if (functionResponses.length > 0 || otherParts.length > 0) {
    void geminiClient.addHistory({
      role: 'user',
      parts: [...functionResponses, ...otherParts],
    });
  }

  markToolsAsSubmitted(tools.map((tc) => tc.request.callId));
}

/**
 * Detects new successful save_memory calls and triggers a refresh if found.
 * Marks newly processed tools in the processedMemoryToolsRef set.
 */
export function processMemoryToolResults(
  primaryTools: Array<TrackedCompletedToolCall | TrackedCancelledToolCall>,
  processedMemoryToolsRef: React.MutableRefObject<Set<string>>,
  performMemoryRefresh: () => Promise<void>,
): void {
  const newSuccessfulMemorySaves = primaryTools.filter(
    (t) =>
      t.request.name === 'save_memory' &&
      t.status === 'success' &&
      !processedMemoryToolsRef.current.has(t.request.callId),
  );

  if (newSuccessfulMemorySaves.length > 0) {
    void performMemoryRefresh();
    newSuccessfulMemorySaves.forEach((t) =>
      processedMemoryToolsRef.current.add(t.request.callId),
    );
  }
}

// ─── Module-level implementation (no React hooks) ────────────────────────────

/** submitQueryRef type alias for readability. */
type SubmitQueryRef = React.MutableRefObject<
  | ((
      query: PartListUnion,
      options?: { isContinuation: boolean },
      prompt_id?: string,
    ) => Promise<void>)
  | null
>;

/**
 * Core tool-completion logic extracted from the useCallback to keep
 * useToolCompletionHandler under 80 lines.
 * Contains all the branching logic for cancelled turns, external agents,
 * client-initiated tools, memory refreshes, and normal continuation.
 */
async function _executeCompletedTools(
  completedToolCallsFromScheduler: TrackedToolCall[],
  turnCancelledRef: React.MutableRefObject<boolean>,
  submitQueryRef: SubmitQueryRef,
  geminiClient: GeminiClient,
  markToolsAsSubmitted: (callIds: string[]) => void,
  performMemoryRefresh: () => Promise<void>,
  onTodoPause: (() => void) | undefined,
  processedMemoryToolsRef: React.MutableRefObject<Set<string>>,
): Promise<void> {
  geminiStreamLogger.debug(
    `handleCompletedTools: processing ${completedToolCallsFromScheduler.length} tool(s)`,
  );

  // Issue #968: Turn was cancelled — record history but do not continue.
  if (turnCancelledRef.current) {
    const completedWithResponses = completedToolCallsFromScheduler.filter(
      (tc): tc is TrackedCompletedToolCall | TrackedCancelledToolCall =>
        (tc.status === 'success' ||
          tc.status === 'error' ||
          tc.status === 'cancelled') &&
        (tc as TrackedCompletedToolCall | TrackedCancelledToolCall).response
          ?.responseParts !== undefined,
    );
    if (completedWithResponses.length > 0) {
      recordCancelledToolHistory(
        completedWithResponses,
        geminiClient,
        markToolsAsSubmitted,
      );
    }
    return;
  }

  const { primaryTools, externalTools } = classifyCompletedTools(
    completedToolCallsFromScheduler,
  );
  if (externalTools.length > 0) {
    markToolsAsSubmitted(externalTools.map((tc) => tc.request.callId));
  }
  if (primaryTools.length === 0) return;

  // todo_pause: signal the UI to pause, but continue processing
  if (
    primaryTools.some(
      (tc) => tc.request.name === 'todo_pause' && tc.status === 'success',
    )
  ) {
    onTodoPause?.();
  }

  const clientTools = primaryTools.filter((t) => t.request.isClientInitiated);
  if (clientTools.length > 0)
    markToolsAsSubmitted(clientTools.map((t) => t.request.callId));

  processMemoryToolResults(
    primaryTools,
    processedMemoryToolsRef,
    performMemoryRefresh,
  );

  const geminiTools = primaryTools.filter((t) => !t.request.isClientInitiated);
  if (geminiTools.length === 0) return;

  if (geminiTools.every((tc) => tc.status === 'cancelled')) {
    recordCancelledToolHistory(geminiTools, geminiClient, markToolsAsSubmitted);
    return;
  }

  // Normal completion — markToolsAsSubmitted MUST precede submitQuery to prevent reprocessing
  const responsesToSend = buildToolResponses(geminiTools);
  const prompt_ids = geminiTools.map((tc) => tc.request.prompt_id);
  markToolsAsSubmitted(geminiTools.map((tc) => tc.request.callId));
  void submitQueryRef.current?.(
    responsesToSend,
    { isContinuation: true },
    prompt_ids[0],
  );
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseToolCompletionHandlerReturn {
  /** Processes completed tool calls. Queues them if the stream is active. */
  handleCompletedTools: (
    tools: TrackedToolCall[],
    skipRespondingCheck?: boolean,
  ) => Promise<void>;
  /** Ref holding the latest handleCompletedTools for use in effects. */
  handleCompletedToolsRef: React.MutableRefObject<
    | ((
        tools: TrackedToolCall[],
        skipRespondingCheck?: boolean,
      ) => Promise<void>)
    | null
  >;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Extracts tool completion handling from the orchestrator.
 *
 * @param isResponding - Whether the Gemini stream is currently active.
 * @param turnCancelledRef - Ref that is true when the user has cancelled the turn.
 * @param submitQueryRef - Ref holding the latest submitQuery callback (avoids circular deps).
 * @param geminiClient - Gemini API client for adding history.
 * @param markToolsAsSubmitted - Scheduler function to finalize tool call IDs.
 * @param performMemoryRefresh - Callback to refresh in-memory data after save_memory.
 * @param onTodoPause - Optional callback when todo_pause tool succeeds.
 */
export function useToolCompletionHandler(
  isResponding: boolean,
  turnCancelledRef: React.MutableRefObject<boolean>,
  submitQueryRef: SubmitQueryRef,
  geminiClient: GeminiClient,
  markToolsAsSubmitted: (callIds: string[]) => void,
  performMemoryRefresh: () => Promise<void>,
  onTodoPause?: () => void,
): UseToolCompletionHandlerReturn {
  const pendingToolCompletionsRef = useRef<TrackedToolCall[]>([]);
  const processedMemoryToolsRef = useRef<Set<string>>(new Set());
  const handleCompletedToolsRef = useRef<
    | ((
        tools: TrackedToolCall[],
        skipRespondingCheck?: boolean,
      ) => Promise<void>)
    | null
  >(null);

  const handleCompletedTools = useCallback(
    async (
      completedToolCallsFromScheduler: TrackedToolCall[],
      skipRespondingCheck = false,
    ) => {
      // Issue #1113: If stream active, queue for deferred processing.
      if (!skipRespondingCheck && isResponding) {
        geminiStreamLogger.debug(
          `handleCompletedTools: stream active, queuing ${completedToolCallsFromScheduler.length} tool(s) for deferred processing`,
        );
        pendingToolCompletionsRef.current.push(
          ...completedToolCallsFromScheduler,
        );
        return;
      }
      await _executeCompletedTools(
        completedToolCallsFromScheduler,
        turnCancelledRef,
        submitQueryRef,
        geminiClient,
        markToolsAsSubmitted,
        performMemoryRefresh,
        onTodoPause,
        processedMemoryToolsRef,
      );
    },
    [
      isResponding,
      turnCancelledRef,
      submitQueryRef,
      geminiClient,
      markToolsAsSubmitted,
      performMemoryRefresh,
      onTodoPause,
    ],
  );

  // Keep the ref updated so the deferred effect always calls the latest callback
  useEffect(() => {
    handleCompletedToolsRef.current = handleCompletedTools;
  }, [handleCompletedTools]);

  // Issue #1113: Process any tool completions that arrived while isResponding=true
  useEffect(() => {
    geminiStreamLogger.debug(
      `pendingToolCompletions effect: isResponding=${isResponding}, pendingCount=${pendingToolCompletionsRef.current.length}`,
    );
    if (!isResponding && pendingToolCompletionsRef.current.length > 0) {
      const pendingTools = [...pendingToolCompletionsRef.current];
      pendingToolCompletionsRef.current = [];
      geminiStreamLogger.debug(
        `pendingToolCompletions effect: processing ${pendingTools.length} queued tools`,
      );
      void handleCompletedToolsRef.current?.(pendingTools, true);
    }
  }, [isResponding]);

  return { handleCompletedTools, handleCompletedToolsRef };
}
