/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turn execution + operation-lifecycle helpers extracted from useSubmitQuery
 * (issue #3167). Contains the core submit-query execution path that prepares
 * the query, runs the stream, and finalises the operation-lifecycle registry
 * with the correct terminal status — preserving fail-fast / internal-error
 * semantics and granular cancellation classification.
 */

import type { AgentRequestInput } from '@vybestack/llxprt-code-core';
import { prepareTurnForQuery } from './turnPreparation.js';
import { handleSubmissionError } from './streamUtils.js';
import {
  observeTurnFailed,
  observeTurnStarted,
} from '../../../observation/jspWiring.js';
import type {
  OperationLifecycleRegistry,
  OperationStatus,
} from './operationLifecycle.js';
import type { UseSubmitQueryDeps } from './useSubmitQuery.js';

export interface TurnInit {
  userMessageTimestamp: number;
  abortSignal: AbortSignal;
  promptId: string;
  trimmedStr: string;
}

export interface SubmitQueryCallbackDeps extends UseSubmitQueryDeps {
  displayUserMessage: (q: string, t: number) => void;
  prepareQueryForAgent: (
    query: AgentRequestInput,
    userMessageTimestamp: number,
    abortSignal: AbortSignal,
    promptId: string,
  ) => Promise<{
    queryToSend: AgentRequestInput | null;
    shouldProceed: boolean;
  }>;
  handleLoopDetectedEvent: () => void;
  startNewPrompt: () => void;
  getPromptCount: () => number;
  activeTurnRef: React.MutableRefObject<boolean>;
  scheduleNextQueuedSubmission: () => void;
}

/**
 * Returns the finalise promise so callers can await it. The registry's own
 * error policy rejects on internal/schema failures (fail-fast — D8) and
 * resolves on filesystem errno errors (fail-open inside PerfSink/retention).
 * Callers await this so internal instrumentation errors propagate rather
 * than being silently debug-logged and swallowed.
 */
function finaliseOperation(
  lifecycle: OperationLifecycleRegistry | undefined,
  signal: AbortSignal,
  status: OperationStatus,
): Promise<void> | undefined {
  return lifecycle?.finalise(signal, status);
}

/**
 * Finalises as 'error' after a preparation rejection, preserving the original
 * rejection to the caller. If the instrumentation finalise also has an internal
 * failure, an AggregateError carries both (project convention). Always throws.
 */
async function finalisePrepRejection(
  lifecycle: OperationLifecycleRegistry | undefined,
  signal: AbortSignal,
  prepError: unknown,
  context: string,
): Promise<never> {
  try {
    await finaliseOperation(lifecycle, signal, 'error');
  } catch (finaliseError) {
    throw new AggregateError(
      [prepError, finaliseError],
      `${context} (with instrumentation error)`,
    );
  }
  throw prepError;
}

/**
 * Finalises once as the given cancellation status, preserving the original
 * cancellation error to the caller. If the instrumentation finalise has an
 * internal failure, an AggregateError carries both the original cancellation
 * and the finalisation error (project convention). Always throws.
 */
async function finaliseCancellation(
  lifecycle: OperationLifecycleRegistry | undefined,
  signal: AbortSignal,
  cancelError: unknown,
  status: OperationStatus,
  context: string,
): Promise<never> {
  try {
    await finaliseOperation(lifecycle, signal, status);
  } catch (finaliseError) {
    throw new AggregateError(
      [cancelError, finaliseError],
      `${context} (with instrumentation error)`,
    );
  }
  throw cancelError;
}

/**
 * Finalises once as 'error' after a failure that occurs AFTER a successful
 * `operationLifecycle.begin` but BEFORE `runSubmitQueryCore` (e.g. a throwing
 * `displayUserMessage`). The original failure is preserved; if finalisation
 * also has an internal failure, both are surfaced via AggregateError. Always
 * throws. Exported so the caller (which owns the `begin` call) can finalise
 * exactly once when an intermediate step throws.
 */
export async function finaliseOnceAfterBegin(
  lifecycle: OperationLifecycleRegistry | undefined,
  signal: AbortSignal,
  originalError: unknown,
  context: string,
): Promise<never> {
  try {
    await finaliseOperation(lifecycle, signal, 'error');
  } catch (finaliseError) {
    throw new AggregateError(
      [originalError, finaliseError],
      `${context} (with instrumentation error)`,
    );
  }
  throw originalError;
}

/**
 * Handles a provider stream error for the user (observeTurnFailed +
 * handleSubmissionError) only when this turn still owns the controller.
 */
function handleProviderError(
  cbd: SubmitQueryCallbackDeps,
  turn: TurnInit,
  error: unknown,
): void {
  if (isCurrentTurn(cbd, turn.abortSignal)) {
    observeTurnFailed();
    handleSubmissionError(
      error,
      cbd.addItem,
      cbd.runtime,
      cbd.onAuthError,
      turn.userMessageTimestamp,
    );
  }
}

/**
 * Finalises a provider stream error as 'error'. The original provider error is
 * handled for the user via handleSubmissionError. If the finalise has an
 * internal failure, the provider error is handled FIRST (so it is not lost),
 * then the instrumentation error fails-fast (D8). The instrumentation error is
 * NOT routed through user-facing provider-error handling.
 */
async function finaliseStreamError(
  cbd: SubmitQueryCallbackDeps,
  turn: TurnInit,
  streamError: unknown,
): Promise<void> {
  try {
    await finaliseOperation(cbd.operationLifecycle, turn.abortSignal, 'error');
  } catch (finaliseError) {
    handleProviderError(cbd, turn, streamError);
    throw finaliseError;
  }
  handleProviderError(cbd, turn, streamError);
}

/**
 * Prepares the query for the agent, returning the query to send or throwing
 * after finalising the operation appropriately. Handles cancellation during
 * prep (cancelled_before_send) and genuine errors (error + preserved rejection).
 */
async function prepareAndCheckProceed(
  cbd: SubmitQueryCallbackDeps,
  query: AgentRequestInput,
  turn: TurnInit,
): Promise<AgentRequestInput | null> {
  let queryToSend: AgentRequestInput | null = null;
  let shouldProceed = false;
  try {
    const result = await cbd.prepareQueryForAgent(
      query,
      turn.userMessageTimestamp,
      turn.abortSignal,
      turn.promptId,
    );
    queryToSend = result.queryToSend;
    shouldProceed = result.shouldProceed;
  } catch (prepError) {
    if (isCancellation(prepError, turn.abortSignal)) {
      await finaliseCancellation(
        cbd.operationLifecycle,
        turn.abortSignal,
        prepError,
        'cancelled_before_send',
        'Query preparation cancelled',
      );
    }
    await finalisePrepRejection(
      cbd.operationLifecycle,
      turn.abortSignal,
      prepError,
      'Query preparation failed',
    );
  }

  if (!shouldProceed || queryToSend === null) {
    // Benign no-proceed: the instrumentation finalise propagates fail-fast
    // (D8) — this is intentionally NOT swallowed, consistent with the
    // successful-completion path.
    await finaliseOperation(
      cbd.operationLifecycle,
      turn.abortSignal,
      'cancelled_before_send',
    );
    return null;
  }

  try {
    await prepareTurnForQuery(
      false,
      cbd.runtime,
      cbd.startNewPrompt,
      cbd.setThought,
      cbd.thinkingBlocksRef,
    );
  } catch (prepError) {
    if (isCancellation(prepError, turn.abortSignal)) {
      await finaliseCancellation(
        cbd.operationLifecycle,
        turn.abortSignal,
        prepError,
        'cancelled_before_send',
        'Turn preparation cancelled',
      );
    }
    await finalisePrepRejection(
      cbd.operationLifecycle,
      turn.abortSignal,
      prepError,
      'Turn preparation failed',
    );
  }

  return queryToSend;
}

async function executeStream(
  deps: UseSubmitQueryDeps,
  handleLoopDetectedEvent: () => void,
  queryToSend: AgentRequestInput,
  turn: TurnInit,
): Promise<void> {
  const runStream = deps.runStreamRef.current;
  if (!runStream) {
    throw new Error('Agent event-stream runner is not initialized.');
  }

  // P07: capture client_prepare_ms immediately before the first runStream
  // send (the monotonic delta from begin to just-before-send).
  deps.operationLifecycle?.captureClientPrepare(turn.abortSignal);

  // The Agent owns the entire multi-turn flow: send → stream → schedule →
  // execute → feed-back → repeat.
  await runStream(queryToSend, turn.abortSignal, turn.promptId);

  // A newer turn may have started while runStream was settling (e.g. the user
  // cancelled this turn and submitted a new prompt). If the current
  // AbortController no longer belongs to this turn, skip post-stream cleanup
  // so it does not clobber the newer turn's state (issue #2259).
  if (!isCurrentTurn(deps, turn.abortSignal)) {
    return;
  }

  if (deps.pendingHistoryItemRef.current) {
    deps.flushPendingHistoryItem(turn.userMessageTimestamp);
    deps.setPendingHistoryItem(null);
  }
  if (deps.loopDetectedRef.current) {
    deps.loopDetectedRef.current = false;
    handleLoopDetectedEvent();
  }
}

/**
 * Runs the stream and finalises with the correct terminal status. On
 * cancellation, classifies granularly from live/terminal phase evidence.
 */
async function streamAndFinalise(
  cbd: SubmitQueryCallbackDeps,
  queryToSend: AgentRequestInput,
  turn: TurnInit,
): Promise<void> {
  cbd.operationLifecycle?.enterApiPhase(turn.abortSignal);

  try {
    let streamError: unknown = null;
    try {
      await executeStream(cbd, cbd.handleLoopDetectedEvent, queryToSend, turn);
    } catch (error) {
      streamError = error;
    }

    if (streamError === null) {
      // Successful completion: the instrumentation finalise propagates
      // fail-fast (D8) — this is intentionally NOT swallowed.
      await finaliseOperation(
        cbd.operationLifecycle,
        turn.abortSignal,
        'completed',
      );
    } else if (isCancellation(streamError, turn.abortSignal)) {
      const status =
        cbd.operationLifecycle?.classifyCancellation(turn.abortSignal) ??
        'cancelled_during_api';
      try {
        await finaliseOperation(
          cbd.operationLifecycle,
          turn.abortSignal,
          status,
        );
      } catch (finaliseError) {
        throw new AggregateError(
          [streamError, finaliseError],
          'Query stream cancelled (with instrumentation error)',
        );
      }
    } else {
      await finaliseStreamError(cbd, turn, streamError);
    }
  } finally {
    if (isCurrentTurn(cbd, turn.abortSignal)) {
      cbd.setIsResponding(false);
    }
    if (isCurrentTurn(cbd, turn.abortSignal)) {
      try {
        await cbd.recordingIntegration?.flushAtTurnBoundary();
      } catch {
        /* non-fatal */
      }
    }
  }
}

export async function runSubmitQueryCore(
  cbd: SubmitQueryCallbackDeps,
  query: AgentRequestInput,
  turn: TurnInit,
): Promise<void> {
  const queryToSend = await prepareAndCheckProceed(cbd, query, turn);
  if (queryToSend === null) return;

  cbd.setIsResponding(true);
  cbd.setInitError(null);
  observeTurnStarted();
  cbd.pendingResponse.beginCommittedSegments();

  await streamAndFinalise(cbd, queryToSend, turn);
}

/**
 * Returns true when the given signal still belongs to the active turn. When a
 * newer turn starts (via initTurn) it replaces abortControllerRef.current with
 * a fresh AbortController; comparing signals proves the caller still owns the
 * current AbortController (issue #2259, #2954).
 */
export function isCurrentTurn(
  deps: UseSubmitQueryDeps,
  signal: AbortSignal,
): boolean {
  return deps.abortControllerRef.current?.signal === signal;
}

/**
 * Returns true when an error is an AbortError or the signal is aborted.
 * Used to classify cancellation vs genuine stream errors.
 */
function isCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}
