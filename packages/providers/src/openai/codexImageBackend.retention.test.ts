/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { ImageGenerationError } from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';
import {
  MIB,
  RETAINED_BOUND,
  bigText,
} from '../__tests__/support/retainedText.js';
import { forwardPreconnect } from '../utils/fetchPreconnect.js';
import { CodexImageBackend } from './codexImageBackend.js';

function backendAnswering(status: number, body: string): CodexImageBackend {
  const fetchImpl: typeof fetch = Object.assign(
    async (): Promise<Response> => new Response(body, { status }),
    forwardPreconnect(() => fetch),
  );
  return new CodexImageBackend({
    getCredential: async () => ({ accessToken: 't', accountId: 'a' }),
    getBaseUrl: () => undefined,
    fetchImpl,
  });
}

async function rejection(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => {
      throw new Error('expected the operation to reject');
    },
    (error: unknown) => error,
  );
}

describe('CodexImageBackend error body retention', () => {
  it('keeps none of an error body alive through the snippet on the error', async () => {
    const backend = backendAnswering(502, bigText(24 * MIB));
    const baseline = await settledHeap();
    let held: unknown;
    const fail = async (): Promise<void> => {
      held = await rejection(
        backend.generate({ prompt: 'x' }, new AbortController().signal),
      );
    };
    await fail();
    const afterFailure = await settledHeap();

    expect(held).toBeInstanceOf(ImageGenerationError);
    expect((held as ImageGenerationError).bodySnippet).toHaveLength(501);
    expect(afterFailure - baseline).toBeLessThan(RETAINED_BOUND);
  });
});
