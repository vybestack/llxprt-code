/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  assertRequestMediaBudget,
  DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
  type RequestMediaAccounting,
  type ResolvedMediaRequest,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

export type MediaRequestOutcome =
  | { readonly status: 'succeeded' }
  | { readonly status: 'failed'; readonly error: unknown };

function containsReference(contents: readonly IContent[]): boolean {
  return contents.some(
    (content) =>
      Array.isArray(content.blocks) &&
      content.blocks.some(
        (block) => block.type === 'media' && block.encoding === 'reference',
      ),
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason;
}

function requestIdentity(runtime: ProviderRuntimeContext): string {
  const logicalRequestId = runtime.metadata?.['logicalRequestId'];
  if (typeof logicalRequestId === 'string' && logicalRequestId.length > 0) {
    return logicalRequestId;
  }
  return runtime.runtimeId ?? 'provider-request';
}

function turnIdentity(contents: readonly IContent[]): string {
  if (contents.length === 0) return 'unknown-turn';
  const latest = contents[contents.length - 1];
  const turnId = latest.metadata?.turnId ?? latest.metadata?.id;
  return turnId !== undefined && turnId.length > 0 ? turnId : 'unknown-turn';
}

function unchangedRequest(contents: IContent[]): ResolvedMediaRequest {
  let released = false;
  const cleanups: Array<() => void | Promise<void>> = [];
  const accounting = (): RequestMediaAccounting => ({
    selectedReferenceCount: 0,
    uniqueContentCount: 0,
    selectedNormalizedBytes: 0,
    materializedNormalizedBytes: 0,
    storeReadCount: 0,
    reservedContentCount: 0,
    released,
  });
  return {
    withContents: <T>(consume: (requestContents: IContent[]) => T): T => {
      if (released) {
        throw new Error('Cannot consume media request contents after release');
      }
      return consume(contents);
    },
    registerCleanup: (cleanup: () => void | Promise<void>): void => {
      if (released) {
        throw new Error('Cannot register request cleanup after release');
      }
      cleanups.push(cleanup);
    },
    accounting,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      const failures: unknown[] = [];
      for (let index = cleanups.length - 1; index >= 0; index -= 1) {
        try {
          await cleanups[index]();
        } catch (error) {
          failures.push(error);
        }
      }
      cleanups.splice(0);
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Failed to release media request');
      }
    },
  };
}

export function finishMediaRequest(
  request: ResolvedMediaRequest,
  outcome: Extract<MediaRequestOutcome, { status: 'failed' }>,
): Promise<never>;
export function finishMediaRequest(
  request: ResolvedMediaRequest,
  outcome: Extract<MediaRequestOutcome, { status: 'succeeded' }>,
): Promise<void>;
export function finishMediaRequest(
  request: ResolvedMediaRequest,
  outcome: MediaRequestOutcome,
): Promise<void>;
export async function finishMediaRequest(
  request: ResolvedMediaRequest,
  outcome: MediaRequestOutcome,
): Promise<void> {
  try {
    await request.release();
  } catch (releaseError) {
    if (outcome.status === 'failed') {
      throw new AggregateError(
        [outcome.error, releaseError],
        'Request failed and media request release also failed',
      );
    }
    throw releaseError;
  }
  if (outcome.status === 'failed') throw outcome.error;
}

export async function resolveRequestMedia(
  runtime: ProviderRuntimeContext | undefined,
  contents: IContent[],
  signal: AbortSignal | undefined,
): Promise<ResolvedMediaRequest> {
  throwIfAborted(signal);
  const aggregateBudgetBytes =
    runtime?.requestMediaBudgetBytes ?? DEFAULT_REQUEST_MEDIA_BUDGET_BYTES;
  if (!containsReference(contents)) {
    assertRequestMediaBudget(
      contents,
      turnIdentity(contents),
      aggregateBudgetBytes,
    );
    return Promise.resolve(unchangedRequest(contents));
  }
  if (runtime?.mediaResolver === undefined) {
    const turnId = turnIdentity(contents);
    throw new Error(
      `Provider request contains unresolved media references in turn ${turnId}, but its explicit runtime context has no media resolver`,
    );
  }
  return runtime.mediaResolver.resolve({
    contents,
    requestId: requestIdentity(runtime),
    turnId: turnIdentity(contents),
    aggregateBudgetBytes,
    ...(signal === undefined ? {} : { signal }),
  });
}
