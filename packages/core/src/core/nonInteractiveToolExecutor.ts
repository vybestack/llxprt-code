/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolCallRequestInfo,
  ToolErrorType,
  DEFAULT_AGENT_ID,
} from '../index.js';
import { type Part } from '@google/genai';
import { type Config } from '../config/config.js';
import { type CompletedToolCall } from './coreToolScheduler.js';

/**
 * Configuration subset required for non-interactive tool execution.
 * Uses the scheduler singleton via getOrCreateScheduler/disposeScheduler.
 */
export type ToolExecutionConfig = Pick<
  Config,
  | 'getToolRegistry'
  | 'getEphemeralSettings'
  | 'getEphemeralSetting'
  | 'getExcludeTools'
  | 'getSessionId'
  | 'getTelemetryLogPromptsEnabled'
  | 'getOrCreateScheduler'
  | 'disposeScheduler'
> &
  Partial<Pick<Config, 'getAllowedTools' | 'getApprovalMode'>>;

/**
 * Executes a single tool call non-interactively by leveraging the CoreToolScheduler singleton.
 *
 * This wrapper:
 * 1. Uses the scheduler singleton (via config.getOrCreateScheduler) with interactiveMode: false
 * 2. Schedules the tool call
 * 3. Returns the completed result
 *
 * Non-interactive mode means:
 * - The scheduler uses toolContextInteractiveMode: false so tools know they're non-interactive
 * - No live output updates are provided
 *
 * Benefits of using the singleton scheduler:
 * - Avoids MessageBus subscription spam from repeated scheduler creation
 * - Proper refcount-based lifecycle management
 * - Consistent tool governance path with interactive mode
 *
 * Note: Emoji filtering is handled by the individual tools (edit.ts, write-file.ts)
 * so it is not duplicated here.
 */
export async function executeToolCall(
  config: ToolExecutionConfig,
  toolCallRequest: ToolCallRequestInfo,
  abortSignal?: AbortSignal,
): Promise<CompletedToolCall> {
  const startTime = Date.now();

  const agentId = toolCallRequest.agentId ?? DEFAULT_AGENT_ID;
  toolCallRequest.agentId = agentId;

  const internalAbortController = new AbortController();
  let parentAbortHandler: (() => void) | null = null;
  if (abortSignal) {
    if (abortSignal.aborted) {
      internalAbortController.abort();
    } else {
      parentAbortHandler = (): void => internalAbortController.abort();
      abortSignal.addEventListener('abort', parentAbortHandler, { once: true });
    }
  }

  let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
  const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
    completionResolver = resolve;
  });

  const sessionId = config.getSessionId();

  // Use the singleton scheduler factory with non-interactive mode
  const scheduler = await config.getOrCreateScheduler(
    sessionId,
    {
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (completedToolCalls) => {
        completionResolver?.(completedToolCalls);
      },
    },
    { interactiveMode: false },
  );

  try {
    const effectiveSignal = internalAbortController.signal;
    await scheduler.schedule([toolCallRequest], effectiveSignal);

    const completedCalls = await completionPromise;
    if (completedCalls.length !== 1) {
      throw new Error('Non-interactive executor expects exactly one tool call');
    }

    const completed = completedCalls[0];

    if (!completed.response.agentId) {
      completed.response.agentId = agentId;
    }

    return completed;
  } catch (e) {
    return createErrorCompletedToolCall(
      toolCallRequest,
      e instanceof Error ? e : new Error(String(e)),
      ToolErrorType.UNHANDLED_EXCEPTION,
      Date.now() - startTime,
    );
  } finally {
    if (abortSignal && parentAbortHandler) {
      abortSignal.removeEventListener('abort', parentAbortHandler);
    }
    if (internalAbortController.signal.aborted) {
      scheduler.cancelAll();
    }
    config.disposeScheduler(sessionId);
  }
}

function createErrorCompletedToolCall(
  request: ToolCallRequestInfo,
  error: Error,
  errorType: ToolErrorType,
  durationMs: number,
): CompletedToolCall {
  return {
    status: 'error',
    request,
    response: {
      callId: request.callId,
      agentId: request.agentId ?? DEFAULT_AGENT_ID,
      error,
      errorType,
      resultDisplay: error.message,
      responseParts: [
        // Only functionResponse — the functionCall is already recorded in
        // history from the model's assistant message (Issue #244).
        {
          functionResponse: {
            id: request.callId,
            name: request.name,
            response: { error: error.message },
          },
        },
      ] as Part[],
    },
    durationMs,
  };
}
