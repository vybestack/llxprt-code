/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Explicit terminal status for a single raw provider attempt.
 */
export type AttemptStatus = 'success' | 'error' | 'aborted';

/**
 * Data captured at the start of a raw provider transport attempt.
 */
export interface AttemptStartInfo {
  /** Monotonic timestamp (ms) at the start of the attempt */
  readonly requestStartMs: number;
  /** Unique ID for this individual attempt */
  readonly attemptId: string;
  /** Index within the logical request (0-based) */
  readonly attemptIndex: number;
  /** Provider name for attribution (defaults to recorder's provider) */
  readonly providerName?: string;
  /** Resolved model name for attribution (defaults to recorder's model) */
  readonly modelName?: string;
}

/**
 * Data captured at the terminal end of a raw provider attempt.
 */
export interface AttemptEndInfo {
  /** The attempt ID from AttemptStartInfo */
  readonly attemptId: string;
  /** Index within the logical request (0-based) */
  readonly attemptIndex: number;
  /** Monotonic timestamp (ms) when the attempt started */
  readonly start: number;
  /** Monotonic timestamp (ms) at terminal completion */
  readonly completionMs: number;
  /** Monotonic timestamp (ms) when first token-bearing chunk arrived, or null */
  readonly firstTokenMs: number | null;
  /** Monotonic timestamp (ms) when last token-bearing chunk arrived, or null */
  readonly lastTokenMs: number | null;
  /** Explicit terminal status */
  readonly status: AttemptStatus;
  /** Provider name for attribution */
  readonly providerName: string;
  /** Resolved model name for attribution */
  readonly modelName: string;
  /** Input/prompt tokens, or 0 when unknown */
  readonly inputTokens: number;
  /** Output/completion tokens, or 0 when unknown */
  readonly outputTokens: number;
  /** Cached content tokens, or 0 when unknown */
  readonly cachedTokens: number;
  /** Thoughts/thinking tokens, or 0 when unknown */
  readonly thoughtsTokens: number;
  /** Tool tokens, or 0 when unknown */
  readonly toolTokens: number;
  /** Cache reads from Anthropic-style usage, or undefined when not reported */
  readonly cacheReads?: number;
  /** Cache writes, or undefined/null when not reported */
  readonly cacheWrites?: number | null;
  /** Finish reasons extracted from the stream, or undefined when absent */
  readonly finishReasons?: string[];
  /** Error message when status is error or aborted */
  readonly errorMessage?: string;
}

/**
 * Observer interface invoked by the RetryOrchestrator for each raw provider
 * transport attempt. Stored in GenerateChatOptions.metadata.attemptLifecycle.
 *
 * Exactly one onAttemptStart → onAttemptEnd sequence occurs for every raw
 * attempt: success, error, or aborted.
 */
export interface AttemptLifecycleObserver {
  onAttemptStart(info: AttemptStartInfo): void;
  onAttemptEnd(info: AttemptEndInfo): void;
}

/**
 * Metadata key used to pass the attempt lifecycle observer through
 * GenerateChatOptions.metadata.
 */
export const ATTEMPT_LIFECYCLE_KEY = '__attemptLifecycle';

/**
 * Extract the attempt lifecycle observer from GenerateChatOptions metadata,
 * or return undefined if not set.
 */
export function getAttemptLifecycleObserver(
  metadata: Record<string, unknown> | undefined,
): AttemptLifecycleObserver | undefined {
  if (!metadata) return undefined;
  const raw = metadata[ATTEMPT_LIFECYCLE_KEY];
  if (isAttemptLifecycleObserver(raw)) {
    return raw;
  }
  return undefined;
}

function isAttemptLifecycleObserver(
  raw: unknown,
): raw is AttemptLifecycleObserver {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.onAttemptStart === 'function' &&
    typeof candidate.onAttemptEnd === 'function'
  );
}
