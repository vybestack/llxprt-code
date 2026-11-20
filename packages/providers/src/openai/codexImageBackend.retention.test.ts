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

function backendAnswering(
  status: number,
  body: Uint8Array,
  onRead: (text: string) => void,
): CodexImageBackend {
  class ObservedResponse extends Response {
    override async text(): Promise<string> {
      const text = await super.text();
      onRead(text);
      return text;
    }
  }
  const fetchImpl: typeof fetch = Object.assign(
    async (): Promise<Response> => new ObservedResponse(body, { status }),
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

async function measureRetention(retaining: boolean): Promise<{
  growth: number;
  retained: readonly string[];
}> {
  const retained: string[] = [];
  // A byte body forces Response.text() to decode a new string after the baseline.
  // A string Response can reuse its already-counted input and hide retention.
  const backend = backendAnswering(
    502,
    Buffer.from(bigText(24 * MIB).padEnd(24 * MIB, 'x')),
    (body) => {
      if (retaining) retained.push(body);
    },
  );
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
  if (!(held instanceof ImageGenerationError)) {
    throw new Error('expected ImageGenerationError');
  }
  expect(held.bodySnippet).toHaveLength(501);
  return { growth: afterFailure - baseline, retained };
}

describe('CodexImageBackend error body retention', () => {
  it('keeps none of an error body alive through the snippet on the error', async () => {
    const measured = await measureRetention(false);
    expect(measured.growth).toBeLessThan(RETAINED_BOUND);
    expect(measured.retained).toHaveLength(0);
  });

  it('control: retaining the full HTTP body exceeds three times the same heap gate', async () => {
    const measured = await measureRetention(true);
    expect(measured.growth).toBeGreaterThan(3 * RETAINED_BOUND);
    expect(measured.retained[0]).toHaveLength(24 * MIB);
  });

  it('preserves the original UTF-16 prefix when the snippet cuts an astral character', async () => {
    const prefix = '雪'.repeat(499) + '\ud800';
    const backend = backendAnswering(
      502,
      Buffer.from(prefix + '\udc00' + 'x'.repeat(1000)),
      () => {},
    );
    const held = await rejection(
      backend.generate({ prompt: 'x' }, new AbortController().signal),
    );
    if (!(held instanceof ImageGenerationError)) {
      throw new Error('expected ImageGenerationError');
    }
    expect(held.bodySnippet).toBe(prefix + '…');
  });
});
