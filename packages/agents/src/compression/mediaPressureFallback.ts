/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  buildProviderContent,
  type ProviderContentEnvelope,
} from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  isRequestByteOverflowError,
  type RequestByteOverflowError,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import {
  explainPendingOverflow,
  isPendingRegionProven,
  protectedRegionStart,
  retireEveryHistoricalImage,
} from './historicalImageRetirement.js';
import { PendingMediaBudgetError } from './pendingMediaBudgetError.js';

/**
 * A byte overflow the media fallback may still relieve. A pending-only
 * overflow is already final: no history change can fix it.
 */
export function isRelievableMediaPressure(
  error: unknown,
): error is RequestByteOverflowError {
  return (
    isRequestByteOverflowError(error) &&
    !(error instanceof PendingMediaBudgetError)
  );
}

export interface MediaPressureFallbackInput {
  /** The byte overflow that would otherwise end the turn. */
  readonly error: RequestByteOverflowError;
  /** The request to relieve; its protected region is never rewritten. */
  readonly envelope: ProviderContentEnvelope;
  /**
   * True after a completed compression or truncation. History is then
   * recomposed from the curated history, provided the envelope's pending tail
   * is proven; otherwise the envelope's own contents, including any hook
   * edits, are relieved.
   */
  readonly historyChanged: boolean;
  readonly curated: () => IContent[];
  readonly logger: DebugLogger;
  /** The media budget in force; zero keeps the reject-any-media policy. */
  readonly budgetBytes: number;
  /** Projects a candidate request; rejects with the typed overflow. */
  readonly project: (contents: IContent[]) => Promise<unknown>;
}

/**
 * Final deterministic media fallback (issue #4000): replace every image
 * outside the protected region with its retirement note in the request view,
 * then project exactly once more. Media pressure from history therefore never
 * ends a turn. Bounded: it never retries an unchanged request and never loops.
 *
 * Errors that remain are the ones the request itself cannot drop: the
 * protected region alone over budget raises {@link PendingMediaBudgetError};
 * anything else (such as a body cap that non-image media still exceeds)
 * surfaces the original typed overflow.
 */
export async function relieveMediaPressure(
  input: MediaPressureFallbackInput,
): Promise<IContent[]> {
  if (input.budgetBytes <= 0) {
    throw input.error;
  }
  const { envelope } = input;
  const pending = envelope.pendingContents;
  const contents =
    input.historyChanged &&
    pending !== undefined &&
    isPendingRegionProven(envelope.contents, pending)
      ? buildProviderContent(input.curated(), pending, input.logger)
      : envelope.contents;
  const start = protectedRegionStart(contents, pending);
  const retired = retireEveryHistoricalImage(contents, start);
  const protectedRegion = retired.slice(start);
  if (retired === contents) {
    throw explainPendingOverflow(input.error, protectedRegion);
  }
  try {
    await input.project(retired);
  } catch (error) {
    if (!isRequestByteOverflowError(error)) {
      throw error;
    }
    const explained = explainPendingOverflow(error, protectedRegion);
    throw explained instanceof PendingMediaBudgetError
      ? explained
      : input.error;
  }
  return retired;
}
