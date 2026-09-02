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
  /**
   * Raw token-delta timing signal (issue #3473). Invoked by the provider
   * stream processor at each raw token-bearing delta (reasoning, content,
   * or tool-call fragment) that may yield no visible chunk until much
   * later. Optional so observers that only track attempt lifecycles need
   * no changes; when present it must be a function or the observer is
   * rejected by the metadata guard.
   */
  onRawTokenDelta?(): void;
}

/**
 * Metadata key used to pass the attempt lifecycle observer through
 * GenerateChatOptions.metadata.
 */
export const ATTEMPT_LIFECYCLE_KEY = '__attemptLifecycle';

/**
 * Metadata key carrying the caller-visible logical request id (e.g. the
 * agents-layer prompt id) through GenerateChatOptions.metadata, so wrapper
 * records join caller-side registries instead of minting a parallel id
 * namespace (issue #3257).
 */
export const LOGICAL_REQUEST_ID_KEY = '__logicalRequestId';

/**
 * Extract the logical request id from GenerateChatOptions metadata.
 * Returns a non-empty string when present, otherwise undefined.
 */
export function extractLogicalRequestId(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) return undefined;
  const raw = metadata[LOGICAL_REQUEST_ID_KEY];
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return raw;
}

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

/**
 * Resolve the raw token-delta timing notifier from GenerateChatOptions
 * metadata (issue #3473). Providers call this once per request and invoke
 * the returned notifier at each raw token-bearing delta. Returns undefined
 * when no observer (or no timing hook) is present, leaving attempt timing
 * to visible-chunk stamping.
 */
export function resolveRawTokenDeltaNotifier(
  metadata: Record<string, unknown> | undefined,
): (() => void) | undefined {
  const observer = getAttemptLifecycleObserver(metadata);
  if (observer?.onRawTokenDelta === undefined) {
    return undefined;
  }
  return observer.onRawTokenDelta.bind(observer);
}

/**
 * True when an optional observer hook value is absent or a function.
 * Present-but-non-function hooks are malformed external input: accepting
 * them would make hook resolution (e.g. onRawTokenDelta.bind) throw at
 * request time instead of degrading to visible-chunk timing.
 */
function isOptionalFunctionHook(value: unknown): boolean {
  return value === undefined || typeof value === 'function';
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
    typeof candidate.onAttemptEnd === 'function' &&
    isOptionalFunctionHook(candidate.onRawTokenDelta)
  );
}
