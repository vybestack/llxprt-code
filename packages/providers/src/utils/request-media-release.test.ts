/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { finishMediaRequest } from './request-media-resolution.js';

function requestWithRelease(
  release: () => Promise<void>,
): ResolvedMediaRequest {
  return {
    withContents: (consume) => consume([]),
    registerCleanup: () => undefined,
    accounting: () => ({
      selectedReferenceCount: 0,
      uniqueContentCount: 0,
      selectedNormalizedBytes: 0,
      materializedNormalizedBytes: 0,
      storeReadCount: 0,
      reservedContentCount: 0,
      released: false,
    }),
    release,
  };
}

describe('finishMediaRequest', () => {
  it('retains the primary error first and release failure second', async () => {
    const primary = new Error('transport start failed');
    const cleanup = new Error('request release failed');
    const request = requestWithRelease(() => Promise.reject(cleanup));

    const error = await finishMediaRequest(request, {
      status: 'failed',
      error: primary,
    }).catch((reason: unknown) => reason);

    if (!(error instanceof AggregateError)) {
      throw new Error('expected an AggregateError');
    }

    expect(error.errors).toStrictEqual([primary, cleanup]);
  });

  it('propagates a release-only failure', async () => {
    const cleanup = new Error('request release failed');
    const request = requestWithRelease(() => Promise.reject(cleanup));

    const error = await finishMediaRequest(request, {
      status: 'succeeded',
    }).catch((reason: unknown) => reason);

    expect(error).toBe(cleanup);
  });

  it('propagates the primary error when release succeeds', async () => {
    const primary = new Error('request dump failed');
    const request = requestWithRelease(() => Promise.resolve());

    const error = await finishMediaRequest(request, {
      status: 'failed',
      error: primary,
    }).catch((reason: unknown) => reason);

    expect(error).toBe(primary);
  });
});
