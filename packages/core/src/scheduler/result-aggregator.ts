/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @internal
 * Owns result buffering, ordered publishing, and batch output-limit computation.
 * Extracted from CoreToolScheduler as part of the Phase 2 decomposition
 * (issue 1580).
 *
 * Ordering guarantee: results are published in `executionIndex` order
 * regardless of which tool finishes first, using a reentrancy-guarded loop
 * with a `setImmediate` recovery path for the race where a result arrives
 * after the loop exits but before the flag is cleared.
 */

import type { ToolCallResponseInfo } from '../core/turn.js';
import type { ToolResult } from '../tools/tools.js';
import { ToolErrorType } from '../tools/tool-error.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';
import {
  convertToFunctionResponse,
  extractAgentIdFromMetadata,
  createErrorResponse,
} from '../utils/generateContentResponseUtilities.js';
import {
  DEFAULT_MAX_TOKENS,
  type ToolOutputSettingsProvider,
} from '../utils/toolOutputLimiter.js';
import { DebugLogger } from '../debug/index.js';
import type { ScheduledToolCall } from './types.js';
import type { Part } from '@google/genai';

const logger = new DebugLogger('llxprt:scheduler:result-aggregator');

// ---- callback interface -----------------------------------------------------

/**
 * Callbacks provided by CoreToolScheduler so ResultAggregator can publish
 * without importing the scheduler class (prevents circular dependency).
 */
export interface ResultPublishCallbacks {
  /** Transition a call to the 'success' terminal state. */
  setSuccess(callId: string, response: ToolCallResponseInfo): void;
  /** Transition a call to the 'error' terminal state. */
  setError(callId: string, response: ToolCallResponseInfo): void;
  /**
   * Returns the active Config (or equivalent provider) so ResultAggregator
   * can compute per-tool token limits when no batch override is in effect.
   */
  getFallbackOutputConfig(): ToolOutputSettingsProvider;
}

// ---- internal buffer entry type --------------------------------------------

interface BufferedEntry {
  result: ToolResult;
  callId: string;
  toolName: string;
  scheduledCall: ScheduledToolCall;
  executionIndex: number;
  /** If true, skip publishing — the call is already in 'cancelled' terminal state. */
  isCancelled?: boolean;
}

// ---- ResultAggregator -------------------------------------------------------

/**
 * @internal
 */
export class ResultAggregator {
  /** Pending tool results keyed by callId. */
  private readonly pendingResults = new Map<string, BufferedEntry>();
  /** The executionIndex of the next result to publish. */
  private nextPublishIndex = 0;
  /** Total tools in the current batch; set by {@link beginBatch}. */
  private currentBatchSize = 0;
  /**
   * Per-tool output config derived by dividing the batch token budget equally.
   * Undefined when the batch has ≤ 1 tool.
   */
  private batchOutputConfig: ToolOutputSettingsProvider | undefined = undefined;
  /** Reentrancy guard for {@link publishBufferedResults}. */
  private isPublishingBufferedResults = false;
  /** Set when a second publish is requested during an active publish pass. */
  private pendingPublishRequest = false;

  constructor(private readonly callbacks: ResultPublishCallbacks) {}

  // ---- public buffering API ------------------------------------------------

  /** Store a successful tool result for ordered publishing. */
  bufferResult(
    callId: string,
    toolName: string,
    scheduledCall: ScheduledToolCall,
    result: ToolResult,
    executionIndex: number,
  ): void {
    this.pendingResults.set(callId, {
      result,
      callId,
      toolName,
      scheduledCall,
      executionIndex,
    });
  }

  /** Store an error result (ToolResult with `.error` set) for ordered publishing. */
  bufferError(
    callId: string,
    toolName: string,
    scheduledCall: ScheduledToolCall,
    error: Error,
    executionIndex: number,
  ): void {
    const errorResult: ToolResult = {
      error: {
        message: error.message,
        type: ToolErrorType.UNHANDLED_EXCEPTION,
      },
      llmContent: error.message,
      returnDisplay: error.message,
    };
    this.pendingResults.set(callId, {
      result: errorResult,
      callId,
      toolName,
      scheduledCall,
      executionIndex,
    });
  }

  /**
   * Store a placeholder for a cancelled call so the ordered-publish loop can
   * advance past this index.  The call is already in 'cancelled' terminal state
   * so no callback is fired — the entry is simply discarded after its index is
   * consumed.
   */
  bufferCancelled(
    callId: string,
    scheduledCall: ScheduledToolCall,
    executionIndex: number,
  ): void {
    const cancelledResult: ToolResult = {
      error: {
        message: 'Tool call cancelled by user.',
        type: ToolErrorType.EXECUTION_FAILED,
      },
      llmContent: 'Tool call cancelled by user.',
      returnDisplay: 'Cancelled',
    };
    this.pendingResults.set(callId, {
      result: cancelledResult,
      callId,
      toolName: scheduledCall.request.name,
      scheduledCall,
      executionIndex,
      isCancelled: true,
    });
  }

  // ---- batch initialisation ------------------------------------------------

  /**
   * Called once at the start of each execution batch to record how many tools
   * are participating and to apply proportional output-token limits when the
   * batch has more than one tool.
   */
  beginBatch(size: number): void {
    this.currentBatchSize = size;
    this.applyBatchOutputLimits(size);
  }

  // ---- publishing ----------------------------------------------------------

  /**
   * Publishes buffered results in `executionIndex` order.
   *
   * Reentrancy guard: if called while a publish pass is already running the
   * call sets `pendingPublishRequest` and returns immediately.  The running
   * pass will loop once more before releasing the lock.
   *
   * Recovery path: after releasing the lock we check whether any buffered
   * results are ready (i.e. the next expected index is present) and schedule
   * a follow-up via `setImmediate` to avoid missing results that arrived while
   * the lock was held.
   */
  async publishBufferedResults(signal: AbortSignal): Promise<void> {
    if (this.isPublishingBufferedResults) {
      this.pendingPublishRequest = true;
      return;
    }

    this.isPublishingBufferedResults = true;
    this.pendingPublishRequest = false;

    try {
      do {
        this.pendingPublishRequest = false;
        this.recoverBatchSizeIfNeeded();

        while (this.nextPublishIndex < this.currentBatchSize) {
          const nextBuffered = this.findByExecutionIndex(this.nextPublishIndex);
          if (!nextBuffered) {
            break; // Gap — wait for the missing result to arrive
          }

          if (!nextBuffered.isCancelled) {
            await this.publishResult(nextBuffered, signal);
          }

          this.pendingResults.delete(nextBuffered.callId);
          this.nextPublishIndex++;
        }

        this.resetBatchIfComplete();
      } while (this.pendingPublishRequest);
    } finally {
      this.isPublishingBufferedResults = false;
      this.scheduleFollowUpIfNeeded(signal);
    }
  }

  // ---- state reset ---------------------------------------------------------

  /**
   * Clears all buffered state.  Called by `CoreToolScheduler.cancelAll()` and
   * indirectly by `dispose()`.
   */
  reset(): void {
    this.pendingResults.clear();
    this.nextPublishIndex = 0;
    this.currentBatchSize = 0;
    this.isPublishingBufferedResults = false;
    this.pendingPublishRequest = false;
    this.batchOutputConfig = undefined;
  }

  // ---- private helpers -----------------------------------------------------

  /** Find a buffered entry by its executionIndex. */
  private findByExecutionIndex(index: number): BufferedEntry | undefined {
    for (const entry of this.pendingResults.values()) {
      if (entry.executionIndex === index) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Issue #987 fix: if tools complete before `beginBatch` is called,
   * `currentBatchSize` may still be 0.  Recover it from the actual pending
   * entries so publishing can proceed.
   */
  private recoverBatchSizeIfNeeded(): void {
    if (this.currentBatchSize !== 0 || this.pendingResults.size === 0) {
      return;
    }

    let maxIndex = -1;
    for (const entry of this.pendingResults.values()) {
      if (entry.executionIndex > maxIndex) {
        maxIndex = entry.executionIndex;
      }
    }

    const recovered = Math.min(maxIndex + 1, this.pendingResults.size);
    this.currentBatchSize = recovered > 0 ? recovered : 1;

    if (logger.enabled) {
      logger.debug(
        () =>
          `Recovered batch size from pending results: currentBatchSize=${this.currentBatchSize}, ` +
          `pendingResults.size=${this.pendingResults.size}, maxIndex=${maxIndex}`,
      );
    }
  }

  /** When the entire batch has been published, reset counters for the next batch. */
  private resetBatchIfComplete(): void {
    if (
      this.nextPublishIndex === this.currentBatchSize &&
      this.currentBatchSize > 0
    ) {
      this.nextPublishIndex = 0;
      this.currentBatchSize = 0;
      this.pendingResults.clear();
      this.batchOutputConfig = undefined;
    }
  }

  /**
   * After releasing the reentrancy lock, schedule a follow-up publish via
   * `setImmediate` when the next expected result is already buffered.  This
   * handles the race where:
   *  1. We break the inner `while` loop waiting for result N.
   *  2. Result N arrives and calls `publishBufferedResults`.
   *  3. That call sees the lock held, sets `pendingPublishRequest`, and returns.
   *  4. We exit the `do-while` without seeing the flag (it was set after the check).
   */
  private scheduleFollowUpIfNeeded(signal: AbortSignal): void {
    if (this.pendingResults.size === 0) {
      return;
    }
    const hasNext =
      this.findByExecutionIndex(this.nextPublishIndex) !== undefined;
    if (hasNext) {
      setImmediate(() => {
        void this.publishBufferedResults(signal);
      });
    }
  }

  /**
   * Convert a buffered result to a `ToolCallResponseInfo` and invoke the
   * appropriate status callback (`setSuccess` or `setError`).
   */
  private async publishResult(
    buffered: BufferedEntry,
    _signal: AbortSignal,
  ): Promise<void> {
    const { result, callId, toolName, scheduledCall } = buffered;

    if (result.error === undefined) {
      const outputConfig =
        this.batchOutputConfig ?? this.callbacks.getFallbackOutputConfig();
      const responseParts = convertToFunctionResponse(
        toolName,
        callId,
        result.llmContent,
        outputConfig,
      ) as Part[];

      const metadataAgentId = extractAgentIdFromMetadata(result.metadata);

      const successResponse: ToolCallResponseInfo = {
        callId,
        responseParts,
        resultDisplay: result.returnDisplay,
        error: undefined,
        errorType: undefined,
        agentId:
          metadataAgentId ?? scheduledCall.request.agentId ?? DEFAULT_AGENT_ID,
        ...(result.suppressDisplay !== undefined && {
          suppressDisplay: result.suppressDisplay,
        }),
      };

      logger.debug(
        `callId=${callId}, toolName=${toolName}, returnDisplay type=${typeof result.returnDisplay}, hasValue=${!!result.returnDisplay}`,
      );

      this.callbacks.setSuccess(callId, successResponse);
    } else {
      const error = new Error(result.error.message);
      const errorResponse = createErrorResponse(
        scheduledCall.request,
        error,
        result.error.type,
      );
      this.callbacks.setError(callId, errorResponse);
    }
  }

  /**
   * Apply batch-level output limits for parallel tool batches. (#1301)
   *
   * `tool-output-max-tokens` is treated as a budget for the entire batch.
   * For batches of 2+ tools this method divides the budget equally and stores
   * the reduced per-tool limit in {@link batchOutputConfig}, which
   * {@link publishResult} picks up when building function-response parts.
   */
  private applyBatchOutputLimits(batchSize: number): void {
    if (batchSize <= 1) {
      this.batchOutputConfig = undefined;
      return;
    }

    try {
      const fallback = this.callbacks.getFallbackOutputConfig();
      const ephemeral =
        typeof fallback.getEphemeralSettings === 'function'
          ? fallback.getEphemeralSettings()
          : {};

      const maxBatchTokens =
        (ephemeral['tool-output-max-tokens'] as number | undefined) ??
        DEFAULT_MAX_TOKENS;

      const perToolBudget = Math.max(
        1000,
        Math.floor(maxBatchTokens / batchSize),
      );

      if (logger.enabled) {
        logger.debug(
          () =>
            `Batch of ${batchSize} tools: applying per-tool output limit ` +
            `of ${perToolBudget} tokens (batch budget: ${maxBatchTokens}).`,
        );
      }

      this.batchOutputConfig = {
        getEphemeralSettings: () => ({
          ...ephemeral,
          'tool-output-max-tokens': perToolBudget,
          ...(!ephemeral['tool-output-truncate-mode']
            ? { 'tool-output-truncate-mode': 'truncate' }
            : {}),
        }),
      };
    } catch (error) {
      if (logger.enabled) {
        logger.debug(
          () =>
            `Failed to compute batch output limits; skipping budget guard: ${error}`,
        );
      }
      this.batchOutputConfig = undefined;
    }
  }
}
