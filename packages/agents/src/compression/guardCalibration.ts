/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RuntimeCompressionGuardInfo,
  RuntimeProvider,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { isRequestByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

/**
 * The fixed per-request overhead of the context guard (tool schemas, system
 * prompt: what its envelope estimate carries and a contents-only estimate
 * cannot see), and the estimator every later fit check must use with it.
 */
export interface GuardCalibration {
  readonly overhead: number;
  /**
   * True when the original request could not be estimated by the finalized
   * estimator because it overflows on bytes. The overhead was then measured
   * with the content estimator, and so must every comparison against it.
   */
  readonly measuresByContents: boolean;
}

export interface GuardCalibrationInput {
  /** The guard's finalized-envelope estimate of the original request. */
  readonly guardEstimatedTokens: number;
  /** The request the guard measured, before any media relief. */
  readonly original: readonly IContent[];
  /** Same estimator the enforcer's fit checks use; rejects on byte overflow. */
  readonly estimateOwn: (contents: IContent[]) => Promise<number>;
  /** Content-only estimator that never projects through the provider. */
  readonly estimateByContents: (contents: IContent[]) => Promise<number>;
}

/**
 * Measures the guard's fixed overhead once, from the ORIGINAL request, so the
 * tokens a relieved request saves by retiring images are never counted as
 * overhead (issue #4000). Recomputing it from already-relieved contents would
 * subtract the savings from the limit.
 */
export async function calibrateGuardOverhead(
  input: GuardCalibrationInput,
): Promise<GuardCalibration> {
  const original = [...input.original];
  try {
    const own = await input.estimateOwn(original);
    return {
      overhead: Math.max(0, input.guardEstimatedTokens - own),
      measuresByContents: false,
    };
  } catch (error) {
    if (!isRequestByteOverflowError(error)) {
      throw error;
    }
  }
  const own = await input.estimateByContents(original);
  return {
    overhead: Math.max(0, input.guardEstimatedTokens - own),
    measuresByContents: true,
  };
}

/**
 * The finalized estimator projects a request through the provider, so it also
 * rejects one that overflows on bytes. With `byContents` the content estimate
 * is reported instead (the overhead was calibrated against it), but the
 * finalized estimator still runs to validate the request.
 */
export async function measureRequestTokens(
  input: {
    readonly finalized?: (contents: IContent[]) => Promise<number>;
    readonly byContents: (contents: IContent[]) => Promise<number>;
    readonly preferContents: boolean;
  },
  contents: IContent[],
): Promise<number> {
  if (input.finalized === undefined) {
    return input.byContents(contents);
  }
  const finalized = await input.finalized(contents);
  return input.preferContents ? input.byContents(contents) : finalized;
}

/** One compression-callback invocation and the guard facts it carries. */
export interface CallbackRequest {
  readonly promptId: string;
  readonly guard: RuntimeCompressionGuardInfo | undefined;
  readonly provider: RuntimeProvider | undefined;
  /** The guard overhead measured once from the original request, if known. */
  readonly calibration: GuardCalibration | undefined;
}
