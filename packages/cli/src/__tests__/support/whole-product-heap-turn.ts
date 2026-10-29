/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import type { WholeProductFixture } from './whole-product-fixture.js';
import { heapText } from './whole-product-transport.js';
import { warmupTokenCache } from './warmup-token-cache.js';
import {
  wholeProductWarmup,
  type WholeProductWarmup,
} from './whole-product-warmup.js';

export async function heapTurn(
  fixture: WholeProductFixture,
  turn: number,
  payloadBytes = 65_536,
): Promise<void> {
  let done = 0;
  let calls = 0;
  let results = 0;
  for await (const event of fixture.live.stream(heapText(turn, payloadBytes))) {
    if (event.type === 'error') throw new Error(event.error.message);
    if (event.type === 'done') {
      expect(event.reason).toBe('stop');
      done++;
    }
    if (event.type === 'tool-call') calls++;
    if (event.type === 'tool-result') {
      if (event.result.isError === true)
        throw new Error(JSON.stringify(event.result));
      results++;
    }
  }
  expect(done).toBe(1);
  expect(results).toBe(calls);
  if (turn % 10 === 4) {
    expect(calls).toBe(1);
    expect(await readFile(join(fixture.root, 'heap-receipt.txt'), 'utf8')).toBe(
      `turn ${turn}\n`,
    );
  }
  const history = fixture.clientFor(fixture.live).getHistoryService();
  if (history === null) throw new Error('Missing whole-product history');
  await history.waitForTokenUpdates();
  await history.waitForCommit();
  if (turn % 10 === 5) await fixture.command(`/chat save w24-heap-cut-${turn}`);
  if (turn % 10 === 9) {
    const compressed = await fixture.live.compress({
      promptId: `heap-${turn}`,
    });
    expect(compressed.status).toBe('compressed');
  }
  await fixture.live.session.flushRecording();
}

export async function warmUp(
  fixture: WholeProductFixture,
): Promise<WholeProductWarmup> {
  const restore = warmupTokenCache();
  try {
    return await wholeProductWarmup(
      async (turn, payloadBytes): Promise<void> => {
        if (turn === 500) restore();
        await heapTurn(fixture, turn, payloadBytes);
        if ((turn + 1) % 50 === 0)
          process.stdout.write(`W24 warmup completed ${turn + 1}\n`);
      },
      settledHeap,
    );
  } finally {
    restore();
  }
}
