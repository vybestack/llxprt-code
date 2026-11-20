/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import { readRequestBody, responseBody } from './openai-transport-streams.js';

describe('OpenAI transport stream boundaries', () => {
  it('uploads bytes incrementally and cancels the request when consumption stops', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller): void {
          pulls++;
          controller.enqueue(new Uint8Array([pulls, 255]));
        },
        cancel(): void {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const iterator = readRequestBody(body);
    expect(pulls).toBe(0);
    expect(await iterator.next()).toStrictEqual({
      done: false,
      value: new Uint8Array([1, 255]),
    });
    expect(pulls).toBe(1);
    await iterator.return();
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('preserves Node response bytes through the web Response reader', async () => {
    const source = Readable.from([
      new Uint8Array([0, 255, 195]),
      new Uint8Array([184, 10]),
    ]);
    const response = new Response(responseBody(source));
    expect([...new Uint8Array(await response.arrayBuffer())]).toStrictEqual([
      0, 255, 195, 184, 10,
    ]);
  });

  it('destroys the Node response when its web consumer cancels', async () => {
    const source = new Readable({ read(): void {} });
    const body = responseBody(source);
    await body.cancel();
    expect(source.destroyed).toBe(true);
  });

  it('rejects non-byte response chunks instead of coercing them', async () => {
    const source = Readable.from([{ invalid: true }]);
    await expect(
      new Response(responseBody(source)).arrayBuffer(),
    ).rejects.toThrow('OpenAI response stream requires byte chunks');
  });
});
