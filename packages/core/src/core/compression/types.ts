/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P02
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @plan PLAN-20260211-HIGHDENSITY.P05
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CS-001.1, REQ-CS-001.4, REQ-CS-001.5, REQ-CS-001.6, REQ-CS-010.3
 * @requirement REQ-HD-001.1, REQ-HD-001.2, REQ-HD-001.5, REQ-HD-001.8, REQ-HD-001.9, REQ-HD-004.1
 * @requirement REQ-CR-001, REQ-CR-002
 *
 * Types and constants for the compression strategy module.
 */

import type { IContent, UsageStats } from '../../services/history/IContent.js';
import { getErrorStatus, isNetworkTransientError } from '../../utils/retry.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import type { DebugLogger } from '../../debug/DebugLogger.js';
import type { IProvider } from '../../providers/IProvider.js';
import type { PromptResolver } from '../../prompt-config/prompt-resolver.js';
import type { PromptContext } from '../../prompt-config/types.js';

// ---------------------------------------------------------------------------
// Strategy trigger
// ---------------------------------------------------------------------------

/**
 * Declares how a strategy is activated.
 *
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @requirement REQ-HD-001.1
 * @pseudocode strategy-interface.md lines 11-13
 */
export type StrategyTrigger =
  | { mode: 'threshold'; defaultThreshold: number }
  | { mode: 'continuous'; defaultThreshold: number };

// ---------------------------------------------------------------------------
// High-density result types
// ---------------------------------------------------------------------------

/**
 * Result of a density-optimization pass.
 *
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @requirement REQ-HD-001.5
 * @pseudocode strategy-interface.md lines 16-19
 */
export interface DensityResult {
  readonly removals: readonly number[];
  readonly replacements: ReadonlyMap<number, IContent>;
  readonly metadata: DensityResultMetadata;
}

/**
 * Metadata counts for each pruning type applied during density optimization.
 *
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @requirement REQ-HD-001.8
 * @pseudocode strategy-interface.md lines 22-25
 */
export interface DensityResultMetadata {
  readonly readWritePairsPruned: number;
  readonly fileDeduplicationsPruned: number;
  readonly recencyPruned: number;
}

/**
 * Configuration for density-optimization passes.
 *
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @requirement REQ-HD-001.9
 * @pseudocode strategy-interface.md lines 28-33
 */
export interface DensityConfig {
  readonly readWritePruning: boolean;
  readonly fileDedupe: boolean;
  readonly recencyPruning: boolean;
  readonly recencyRetention: number;
  readonly workspaceRoot: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @requirement REQ-HD-004.1
 * @pseudocode strategy-interface.md lines 36-41
 */
export const COMPRESSION_STRATEGIES = [
  'middle-out',
  'top-down-truncation',
  'one-shot',
  'high-density',
] as const;

export type CompressionStrategyName = (typeof COMPRESSION_STRATEGIES)[number];

// ---------------------------------------------------------------------------
// Core interfaces
// ---------------------------------------------------------------------------

export interface CompressionContext {
  readonly history: readonly IContent[];
  readonly runtimeContext: AgentRuntimeContext;
  readonly runtimeState: AgentRuntimeState;
  readonly estimateTokens: (contents: readonly IContent[]) => Promise<number>;
  readonly currentTokenCount: number;
  readonly logger: DebugLogger;
  readonly resolveProvider: (profileName?: string) => IProvider;
  readonly promptResolver: PromptResolver;
  readonly promptBaseDir: string;
  readonly promptContext: Readonly<Partial<PromptContext>>;
  readonly promptId: string;
  /** @plan PLAN-20260211-HIGHDENSITY.P03 */
  readonly activeTodos?: string;
  /** @plan PLAN-20260211-HIGHDENSITY.P03 */
  readonly transcriptPath?: string;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @requirement REQ-HD-001.1, REQ-HD-001.2
 * @pseudocode strategy-interface.md lines 47-59
 */
export interface CompressionStrategy {
  readonly name: CompressionStrategyName;
  readonly requiresLLM: boolean;
  readonly trigger: StrategyTrigger;
  compress(context: CompressionContext): Promise<CompressionResult>;
  optimize?(history: readonly IContent[], config: DensityConfig): DensityResult;
}

export interface CompressionResult {
  newHistory: IContent[];
  metadata: CompressionResultMetadata;
}

export interface CompressionResultMetadata {
  originalMessageCount: number;
  compressedMessageCount: number;
  strategyUsed: CompressionStrategyName;
  llmCallMade: boolean;
  topPreserved?: number;
  bottomPreserved?: number;
  middleCompressed?: number;
  /** Actual token usage returned by the LLM during compression, if available. */
  usage?: UsageStats;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CompressionStrategyError extends Error {
  readonly code: string;
  readonly strategy?: string;
  readonly profile?: string;

  constructor(
    message: string,
    code: string,
    options?: { strategy?: string; profile?: string },
  ) {
    super(message);
    this.name = 'CompressionStrategyError';
    this.code = code;
    this.strategy = options?.strategy;
    this.profile = options?.profile;
  }
}

export class UnknownStrategyError extends CompressionStrategyError {
  constructor(strategyName: string) {
    super(`Unknown compression strategy: ${strategyName}`, 'UNKNOWN_STRATEGY', {
      strategy: strategyName,
    });
    this.name = 'UnknownStrategyError';
  }
}

export class PromptResolutionError extends CompressionStrategyError {
  constructor(promptId: string, cause?: string) {
    super(
      `Failed to resolve compression prompt "${promptId}"${cause ? `: ${cause}` : ''}`,
      'PROMPT_RESOLUTION_FAILED',
    );
    this.name = 'PromptResolutionError';
  }
}

export class CompressionExecutionError extends CompressionStrategyError {
  /**
   * Whether this execution error is transient (i.e. safe to retry).
   * Defaults to false — most execution failures are permanent logic errors.
   *
   * @plan PLAN-20260218-COMPRESSION-RETRY.P01
   * @requirement REQ-CR-001, REQ-CR-002
   */
  readonly isTransient: boolean;

  constructor(
    strategy: string,
    cause: string,
    profileOrOptions?: string | { profile?: string; isTransient?: boolean },
  ) {
    const profile =
      typeof profileOrOptions === 'string'
        ? profileOrOptions
        : profileOrOptions?.profile;
    super(
      `Compression strategy "${strategy}" failed: ${cause}`,
      'EXECUTION_FAILED',
      { strategy, profile },
    );
    this.name = 'CompressionExecutionError';
    this.isTransient =
      typeof profileOrOptions === 'object'
        ? (profileOrOptions?.isTransient ?? false)
        : false;
  }
}

// ---------------------------------------------------------------------------
// Error classification utilities
// ---------------------------------------------------------------------------

/**
 * Determines whether a compression error is transient (i.e., safe to retry).
 *
 * Transient errors include:
 * - HTTP 429 (rate limit)
 * - HTTP 5xx (server errors)
 * - Network connectivity errors (ECONNRESET, ETIMEDOUT, etc.)
 *
 * Permanent errors include:
 * - CompressionStrategyError subclasses (logic/config failures)
 * - HTTP 4xx (except 429)
 * - Generic programming errors (TypeError, etc.)
 *
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-001, REQ-CR-002
 */
export function isTransientCompressionError(error: unknown): boolean {
  // CompressionStrategyError subclasses are always permanent (logic/config failures)
  // unless the error itself explicitly says it's transient
  if (error instanceof CompressionExecutionError) {
    return error.isTransient;
  }
  if (error instanceof CompressionStrategyError) {
    return false;
  }

  // HTTP status-based classification
  const status = getErrorStatus(error);
  if (status !== undefined) {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    // All other HTTP errors (4xx etc.) are permanent
    return false;
  }

  // Network transient errors (ECONNRESET, ETIMEDOUT, etc.)
  if (isNetworkTransientError(error)) {
    return true;
  }

  return false;
}

/**
 * Returns true if the given error should trigger a retry of the compression
 * operation. This is an alias for {@link isTransientCompressionError} intended
 * for use as a `shouldRetryOnError` predicate.
 *
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-001, REQ-CR-002
 */
export function shouldRetryCompressionError(error: unknown): boolean {
  return isTransientCompressionError(error);
}
