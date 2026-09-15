/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import OpenAI from 'openai';
import {
  createReaderBasedStreamFetch,
  createReaderIteratedBody,
  wrapResponseWithReaderIteratedBody,
} from './openaiStreamFetchSafety.js';

function byteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0, 255, 195]));
      controller.enqueue(new Uint8Array([184, 10]));
      controller.close();
    },
  });
}

function responseFetch(response: Response): typeof fetch {
  return async () => response;
}

function requireBody(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error('Expected response body');
  return response.body;
}

function isIterableBody(
  body: ReadableStream<Uint8Array>,
): body is ReadableStream<Uint8Array> & AsyncIterable<Uint8Array> {
  return typeof Reflect.get(body, Symbol.asyncIterator) === 'function';
}

async function readBodyBytes(response: Response): Promise<readonly number[]> {
  const body = requireBody(response);
  if (!isIterableBody(body)) throw new Error('Expected iterable body');
  const bytes: number[] = [];
  for await (const chunk of body) bytes.push(...chunk);
  return bytes;
}

describe('reader-based OpenAI fetch', () => {
  it('serves full payload bytes from both original and clone bodies when string-backed', async () => {
    const wrapped = wrapResponseWithReaderIteratedBody(new Response('abc'));
    const clone = wrapped.clone();
    const [originalBytes, cloneBytes] = await Promise.all([
      readBodyBytes(wrapped),
      readBodyBytes(clone),
    ]);
    expect(originalBytes).toStrictEqual([97, 98, 99]);
    expect(cloneBytes).toStrictEqual([97, 98, 99]);
  });

  it('serves full payload bytes from both original and clone bodies when stream-backed', async () => {
    const wrapped = wrapResponseWithReaderIteratedBody(
      new Response(byteStream()),
    );
    const clone = wrapped.clone();
    const [originalBytes, cloneBytes] = await Promise.all([
      readBodyBytes(wrapped),
      readBodyBytes(clone),
    ]);
    expect(originalBytes).toStrictEqual([0, 255, 195, 184, 10]);
    expect(cloneBytes).toStrictEqual([0, 255, 195, 184, 10]);
  });

  it('returns the same wrapped body reference while the underlying body is unchanged', () => {
    const wrapped = wrapResponseWithReaderIteratedBody(new Response('abc'));
    expect(wrapped.body).toBe(wrapped.body);
  });

  it('replaces native iteration while preserving every byte', async () => {
    const original = new Response(byteStream());
    const wrapped = await createReaderBasedStreamFetch(responseFetch(original))(
      'http://localhost',
    );
    const body = requireBody(wrapped);
    expect(Reflect.get(body, Symbol.asyncIterator)).not.toBe(
      Reflect.get(requireBody(original), Symbol.asyncIterator),
    );
    const actual: number[] = [];
    if (!isIterableBody(body)) throw new Error('Expected iterable body');
    for await (const bytes of body) actual.push(...bytes);
    const expected: number[] = [];
    const reader = byteStream().getReader();
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      expected.push(...result.value);
    }
    reader.releaseLock();
    expect(actual).toStrictEqual(expected);
    expect(body.locked).toBe(false);
  });

  it('leaves non-OK error responses untouched', async () => {
    const response = new Response('failure', { status: 429 });
    const result = await createReaderBasedStreamFetch(responseFetch(response))(
      'http://localhost',
    );
    expect(result).toBe(response);
    expect(await result.text()).toBe('failure');
  });

  it('leaves responses without bodies untouched', async () => {
    const response = new Response(null, { status: 204 });
    expect(
      await createReaderBasedStreamFetch(responseFetch(response))(
        'http://localhost',
      ),
    ).toBe(response);
  });

  it('leaves bodies without native async iteration untouched', async () => {
    const response = new Response(byteStream());
    Object.defineProperty(requireBody(response), Symbol.asyncIterator, {
      value: undefined,
    });
    expect(
      await createReaderBasedStreamFetch(responseFetch(response))(
        'http://localhost',
      ),
    ).toBe(response);
  });

  it('delegates response metadata and JSON consumption without losing internal slots', async () => {
    const response = new Response(JSON.stringify({ answer: 42 }), {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
    });
    const wrapped = wrapResponseWithReaderIteratedBody(response);
    expect(wrapped.status).toBe(response.status);
    expect(wrapped.statusText).toBe(response.statusText);
    expect(wrapped.ok).toBe(response.ok);
    expect(wrapped.url).toBe(response.url);
    expect(wrapped.type).toBe(response.type);
    expect(wrapped.redirected).toBe(response.redirected);
    expect(wrapped.headers).toBe(response.headers);
    expect(wrapped.bodyUsed).toBe(false);
    const clone = wrapped.clone();
    expect(await wrapped.json()).toStrictEqual({ answer: 42 });
    expect(wrapped.bodyUsed).toBe(true);
    expect(await clone.text()).toBe('{"answer":42}');
  });

  it('cancels and unlocks on iterator return and remains done', async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const iterator = createReaderIteratedBody(source)[Symbol.asyncIterator]();
    await iterator.return();
    expect(cancelled).toBe(true);
    expect(source.locked).toBe(false);
    expect(await iterator.next()).toStrictEqual({
      done: true,
      value: undefined,
    });
  });

  it('preserves direct reader access', async () => {
    const wrapped = wrapResponseWithReaderIteratedBody(
      new Response(byteStream()),
    );
    const reader = requireBody(wrapped).getReader();
    expect(await reader.read()).toStrictEqual({
      done: false,
      value: new Uint8Array([0, 255, 195]),
    });
    await reader.cancel();
    reader.releaseLock();
  });

  it('makes the real SDK use the owned iterator for SSE and usage-only frames', async () => {
    const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
    const frames = [
      { id: 'empty', object: 'chat.completion.chunk', choices: [] },
      {
        id: 'text',
        choices: [
          { index: 0, delta: { content: 'hello' }, finish_reason: null },
        ],
      },
      { id: 'usage', usage },
    ];
    const source = new Response(
      ': keep-alive\n\n' +
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') +
        'data: [DONE]\n\n',
    );
    Object.defineProperty(requireBody(source), Symbol.asyncIterator, {
      value() {
        throw new Error('Native iterator must not be consumed');
      },
    });
    const safeFetch = createReaderBasedStreamFetch(responseFetch(source));
    let ownedIteratorConsumed = false;
    const instrumentedFetch: typeof fetch = async (input, init) => {
      const response = await safeFetch(input, init);
      const body = requireBody(response);
      if (!isIterableBody(body)) throw new Error('Expected owned iterator');
      const iterate = body[Symbol.asyncIterator];
      Object.defineProperty(body, Symbol.asyncIterator, {
        value() {
          ownedIteratorConsumed = true;
          return iterate.call(body);
        },
      });
      return response;
    };
    const client = new OpenAI({
      apiKey: 'test',
      baseURL: 'http://localhost/v1',
      fetch: instrumentedFetch,
    });
    const stream = await client.chat.completions.create({
      model: 'test',
      messages: [],
      stream: true,
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks.map((chunk) => JSON.stringify(chunk))).toStrictEqual(
      frames.map((frame) => JSON.stringify(frame)),
    );
    expect(chunks[chunks.length - 1]?.usage).toStrictEqual(usage);
    expect(ownedIteratorConsumed).toBe(true);
  });

  it('resolves global fetch lazily after wrapper construction', async () => {
    const savedFetch = globalThis.fetch;
    const wrapper = createReaderBasedStreamFetch();
    const response = new Response(null, { status: 204 });
    try {
      globalThis.fetch = responseFetch(response);
      expect(await wrapper('http://localhost')).toBe(response);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
