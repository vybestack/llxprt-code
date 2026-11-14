/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 E6 (risk 14): nothing the size of a request survives from one
 * attempt to the next on the image-dimension recovery path.
 *
 * Two readings. The retry context that is shared across outer attempts may
 * hold only scalars (the recovery's budget), whatever the size of the history.
 * And the settled JS heap while the recovery retry and a later outer attempt
 * are in flight stays where it was while the first request was in flight, for
 * a history whose body is far larger than the allowance. A transport that
 * keeps the parsed first body is the control: the same reading must fail it.
 */

import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  imageDimensionResponse,
  imageRow,
  probeHeapAcrossAttempts,
  rateLimitedResponse,
  sendAndReadRetryContext,
} from './support/imageRecoveryCapture.js';
import { WIRE_ROUTES } from './support/wireBodyCapture.js';
import type { HistoryCase } from './support/wireBodyHistories.js';

const MIB = 1024 * 1024;
const route = WIRE_ROUTES.filter((candidate) =>
  candidate.id.startsWith('anthropic-'),
).find((candidate) => candidate.id === 'anthropic-cache-off');
if (route === undefined) throw new Error('no anthropic-cache-off route');

const ROW_BYTES = 512 * 1024;
const ROWS = 48;
/** Heap growth over the first request that is not a kept copy of a body. */
const ALLOWANCE_BYTES = 6 * MIB;

/** A history of about 24 MiB of text whose first row holds an oversized image. */
function largeHistory(): HistoryCase {
  const rows: IContent[] = [imageRow(3000, 3000, 'look at this')];
  for (let at = 0; at < ROWS; at++) {
    const text = `${at}:`.padEnd(
      ROW_BYTES,
      String.fromCharCode(97 + (at % 26)),
    );
    rows.push(
      at % 2 === 0
        ? { speaker: 'ai', blocks: [{ type: 'text', text }] }
        : { speaker: 'human', blocks: [{ type: 'text', text }] },
    );
  }
  rows.push({ speaker: 'human', blocks: [{ type: 'text', text: 'and now?' }] });
  return { id: 'large-recovery', description: 'a large history', rows };
}

const SCRIPT = [
  imageDimensionResponse,
  rateLimitedResponse,
  () => route.respond(),
];

function onlyScalars(value: unknown, depth = 0): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.length <= 256;
  if (typeof value !== 'object') return typeof value !== 'function';
  if (Array.isArray(value) || depth > 3) return false;
  return Object.values(value).every((entry) => onlyScalars(entry, depth + 1));
}

describe('image recovery keeps no body between attempts', () => {
  it('the shared retry context holds only the recovery budget', async () => {
    const context = await sendAndReadRetryContext(route, largeHistory(), [
      imageDimensionResponse,
      () => route.respond(),
    ]);
    expect(context['anthropicImageRecovery']).toStrictEqual({
      recoveryUsed: true,
      recoveryBudget: { maxDimension: 2000 },
    });
    expect(onlyScalars(context)).toBe(true);
  });

  it('the scalar check rejects a context that holds a body', () => {
    const kept = {
      anthropicImageRecovery: {
        recoveryUsed: true,
        sanitizedBody: {
          model: 'm',
          messages: [{ role: 'user', content: 'x' }],
        },
      },
    };
    expect(onlyScalars(kept)).toBe(false);
  });

  it('the heap during the retry and a later attempt stays at the first request', async () => {
    const history = largeHistory();
    await probeHeapAcrossAttempts(route, history, SCRIPT, settledHeap, false);
    const probe = await probeHeapAcrossAttempts(
      route,
      history,
      SCRIPT,
      settledHeap,
      false,
    );
    expect(probe.requestCount).toBe(3);
    const [first, retry, later] = probe.heapAtRequest;
    expect(retry - first).toBeLessThan(ALLOWANCE_BYTES);
    expect(later - first).toBeLessThan(ALLOWANCE_BYTES);
  }, 180_000);

  it('control: a transport that keeps the rejected body fails the same reading', async () => {
    const history = largeHistory();
    await probeHeapAcrossAttempts(route, history, SCRIPT, settledHeap, false);
    const probe = await probeHeapAcrossAttempts(
      route,
      history,
      SCRIPT,
      settledHeap,
      true,
    );
    const [first, retry, later] = probe.heapAtRequest;
    expect(retry - first).toBeGreaterThan(2 * ALLOWANCE_BYTES);
    expect(later - first).toBeGreaterThan(2 * ALLOWANCE_BYTES);
  }, 180_000);
});
