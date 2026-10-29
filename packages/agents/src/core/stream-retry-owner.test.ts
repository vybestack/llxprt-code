/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createFullLoopHarness,
  extractContentText,
  runFullLoop,
  textIContent,
} from './__tests__/streamPipeline-characterization-helpers.js';

function owner(initialBucket: number) {
  let bucket = initialBucket;
  let failoverSignal: AbortSignal | undefined;
  const response = vi.fn(async function* (): AsyncIterableIterator<IContent> {
    if (bucket === initialBucket) {
      throw Object.assign(new Error('Rate limit exceeded'), {
        status: 429,
        headers: { 'retry-after': '0' },
      });
    }
    yield textIContent(`Recovered bucket ${bucket}`);
  });
  const harness = createFullLoopHarness(
    response,
    undefined,
    async (context) => {
      failoverSignal = context?.signal;
      bucket += 1;
      return true;
    },
    () => String(bucket),
  );
  return { harness, signal: () => failoverSignal };
}

describe('stream retry owner selection', () => {
  it('recovers same-label streams through their separately supplied bucket operations', async () => {
    const left = owner(1);
    const right = owner(10);
    const leftSignal = new AbortController().signal;
    const rightSignal = new AbortController().signal;
    const [leftEvents, rightEvents] = await Promise.all([
      runFullLoop(left.harness.turn, 'recover left', leftSignal),
      runFullLoop(right.harness.turn, 'recover right', rightSignal),
    ]);
    expect(extractContentText(leftEvents)).toBe('Recovered bucket 2');
    expect(extractContentText(rightEvents)).toBe('Recovered bucket 11');
    expect(left.signal()).toBeDefined();
    expect(right.signal()).toBeDefined();
    expect(left.signal()).not.toBe(right.signal());
  });
});
