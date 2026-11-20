/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertDefined } from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it } from 'bun:test';
import {
  BoundedJsonBody,
  DEFAULT_STREAMING_JSON_CHUNK_BYTES,
  jsonValueChunks,
  withBoundedJsonHttpBody,
} from './boundedJsonBody.js';

async function readBody(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = body.getReader();
  let next = await reader.read();
  while (next.done !== true) {
    chunks.push(next.value);
    length += next.value.byteLength;
    next = await reader.read();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

const fixture = {
  model: 'kimi-k3',
  messages: [
    { role: 'system', content: 'stable prompt' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'quote " newline\n emoji \u0000 \u001f 😀' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      ],
    },
  ],
  stream: true,
  omitted: undefined,
  nonFinite: Number.POSITIVE_INFINITY,
};

describe('BoundedJsonBody', () => {
  it('streams bytes exactly equivalent to JSON.stringify without a whole JSON buffer', async () => {
    const expected = new TextEncoder().encode(JSON.stringify(fixture));
    const body = new BoundedJsonBody(fixture, {
      maxChunkBytes: 17,
      maxEnvelopeBytes: expected.byteLength,
    });

    const actual = await readBody(body.createStream());

    expect(actual).toStrictEqual(expected);
    expect(body.byteLength).toBe(expected.byteLength);
    expect(body.accounting().highWaterChunkBytes).toBeLessThanOrEqual(17);
    expect(body.accounting().activeStreamCount).toBe(0);
    expect(body.accounting().activeChunkBytes).toBe(0);
  });

  it('preserves long unescaped base64 runs within exact chunk and envelope bounds', async () => {
    const value = { image: 'QUJD'.repeat(64 * 1024) };
    const expected = new TextEncoder().encode(JSON.stringify(value));
    const body = new BoundedJsonBody(value, {
      maxChunkBytes: 1024,
      maxEnvelopeBytes: expected.byteLength,
    });

    const actual = await readBody(body.createStream());

    expect(actual).toStrictEqual(expected);
    expect(body.byteLength).toBe(expected.byteLength);
    expect(body.accounting().highWaterChunkBytes).toBe(1024);
  });

  it('never passes a whole large string segment to UTF-8 temporary encoding', async () => {
    const maxChunkBytes = 257;
    const value = {
      image: 'QUJD'.repeat(64 * 1024),
      text: `boundary ${String.fromCodePoint(0x1f600).repeat(1024)} \ud800`,
    };
    const expected = new TextEncoder().encode(JSON.stringify(value));
    const originalEncode = TextEncoder.prototype.encode;
    const originalEncodeInto = TextEncoder.prototype.encodeInto;
    let largestEncodingInput = 0;
    TextEncoder.prototype.encode = function (
      input = '',
    ): Uint8Array<ArrayBuffer> {
      largestEncodingInput = Math.max(largestEncodingInput, input.length);
      const encoded = originalEncode.call(this, input);
      const copy = new Uint8Array(encoded.byteLength);
      copy.set(encoded);
      return copy;
    };
    TextEncoder.prototype.encodeInto = function (
      input: string,
      destination: Uint8Array,
    ): TextEncoderEncodeIntoResult {
      largestEncodingInput = Math.max(largestEncodingInput, input.length);
      return originalEncodeInto.call(this, input, destination);
    };
    try {
      const body = new BoundedJsonBody(value, {
        maxChunkBytes,
        maxEnvelopeBytes: expected.byteLength,
      });

      const actual = await readBody(body.createStream());

      expect(actual).toStrictEqual(expected);
      expect(largestEncodingInput).toBeLessThanOrEqual(maxChunkBytes);
      expect(body.accounting()).toMatchObject({
        highWaterEncodingInputCodeUnits: maxChunkBytes,
      });
    } finally {
      TextEncoder.prototype.encode = originalEncode;
      TextEncoder.prototype.encodeInto = originalEncodeInto;
    }
  });

  it('materializes one bounded byte envelope for single-frame transports', () => {
    const value = {
      image: 'QUJD'.repeat(64 * 1024),
      quote: '"',
      emoji: String.fromCodePoint(0x1f600),
    };
    const expected = new TextEncoder().encode(JSON.stringify(value));
    const body = new BoundedJsonBody(value, {
      maxChunkBytes: expected.byteLength,
      maxEnvelopeBytes: expected.byteLength,
    });

    expect(body.toUint8Array()).toStrictEqual(expected);
    expect(
      body.accounting().highWaterEncodingInputCodeUnits,
    ).toBeLessThanOrEqual(DEFAULT_STREAMING_JSON_CHUNK_BYTES);
  });

  it('accepts an envelope at the exact finite limit', async () => {
    const expected = new TextEncoder().encode(JSON.stringify({ value: 'abc' }));
    const body = new BoundedJsonBody(
      { value: 'abc' },
      {
        maxChunkBytes: expected.byteLength,
        maxEnvelopeBytes: expected.byteLength,
      },
    );

    expect(await readBody(body.createStream())).toStrictEqual(expected);
  });

  it('rejects an envelope one byte over before a stream is created', () => {
    const length = new TextEncoder().encode(
      JSON.stringify({ value: 'abc' }),
    ).byteLength;

    expect(
      () =>
        new BoundedJsonBody(
          { value: 'abc' },
          { maxChunkBytes: 8, maxEnvelopeBytes: length - 1 },
        ),
    ).toThrow(`JSON request envelope exceeds ${length - 1} bytes`);
  });

  it('rejects a non-empty body when the chunk bound is zero', () => {
    expect(
      () =>
        new BoundedJsonBody(
          { value: 'abc' },
          { maxChunkBytes: 0, maxEnvelopeBytes: 1024 },
        ),
    ).toThrow('JSON streaming chunk limit is zero');
  });

  it('releases chunk accounting when the consumer cancels', async () => {
    const body = new BoundedJsonBody(
      { value: 'x'.repeat(200) },
      { maxChunkBytes: 8, maxEnvelopeBytes: 1024 },
    );
    const reader = body.createStream().getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel('test cancellation');

    expect(body.accounting().activeStreamCount).toBe(0);
    expect(body.accounting().activeChunkBytes).toBe(0);
  });

  it('rejects a transport envelope bound before invoking the network consumer', async () => {
    let networkStarted = false;

    const error = await withBoundedJsonHttpBody(
      { image: 'QUJD' },
      async () => {
        networkStarted = true;
        return new Response();
      },
      { maxChunkBytes: 8, maxEnvelopeBytes: 4 },
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RangeError);
    expect(networkStarted).toBe(false);
  });

  it('disposes the stream when the body consumer rejects', async () => {
    let accounting:
      | (() => ReturnType<BoundedJsonBody['accounting']>)
      | undefined;

    const error = await withBoundedJsonHttpBody(
      { image: 'QUJD'.repeat(100) },
      async (httpBody) => {
        accounting = httpBody.accounting;
        const reader = httpBody.stream.getReader();
        const first = await reader.read();
        if (first.done === true) throw new Error('expected a body chunk');
        throw new Error('network consumer failed');
      },
      { maxChunkBytes: 8, maxEnvelopeBytes: 2048 },
    ).catch((reason: unknown) => reason);

    assertDefined(accounting, 'accounting was not exposed');
    expect(error).toStrictEqual(new Error('network consumer failed'));
    expect(accounting()).toMatchObject({
      envelopeBytes: 0,

      activeStreamCount: 0,
      activeChunkBytes: 0,
    });
  });

  it('preserves consumer and disposal failures together', async () => {
    const consumerError = new Error('network consumer failed');
    const disposalError = new Error('request body disposal failed');
    const originalCancel = ReadableStreamDefaultReader.prototype.cancel;
    ReadableStreamDefaultReader.prototype.cancel = function (): Promise<void> {
      return Promise.reject(disposalError);
    };
    try {
      const error = await withBoundedJsonHttpBody(
        { image: 'QUJD'.repeat(100) },
        async (httpBody) => {
          const reader = httpBody.stream.getReader();
          const first = await reader.read();
          if (first.done === true) throw new Error('expected a body chunk');
          throw consumerError;
        },
        { maxChunkBytes: 8, maxEnvelopeBytes: 2048 },
      ).catch((reason: unknown) => reason);

      expect(error).toStrictEqual(
        new AggregateError(
          [consumerError, disposalError],
          'Bounded JSON transport and cleanup failed',
        ),
      );
    } finally {
      ReadableStreamDefaultReader.prototype.cancel = originalCancel;
    }
  });

  it('awaits cancellation of a locked stream before disposal settles', async () => {
    const body = new BoundedJsonBody(
      { image: 'QUJD'.repeat(100) },
      { maxChunkBytes: 8, maxEnvelopeBytes: 2048 },
    );
    const reader = body.createStream().getReader();
    const first = await reader.read();
    if (first.done === true) throw new Error('expected a body chunk');

    const disposal = body.dispose();

    expect(disposal).toBeInstanceOf(Promise);
    await disposal;
    expect(await reader.read()).toMatchObject({ done: true });
    expect(body.accounting()).toMatchObject({
      envelopeBytes: 0,
      activeStreamCount: 0,
      activeChunkBytes: 0,
    });
  });

  it('disposal severs the serialization plan and active chunks idempotently', async () => {
    const body = new BoundedJsonBody(
      { image: 'QUJD'.repeat(100) },
      { maxChunkBytes: 8, maxEnvelopeBytes: 2048 },
    );
    const reader = body.createStream().getReader();
    await reader.read();

    await Promise.all([body.dispose(), body.dispose()]);

    expect(body.accounting()).toStrictEqual({
      envelopeBytes: 0,
      activeStreamCount: 0,
      activeChunkBytes: 0,
      highWaterChunkBytes: 8,
      highWaterEncodingInputCodeUnits: 5,
    });
    expect(() => body.createStream()).toThrow('JSON request body was disposed');
  });

  it('releases accounting when serialization fails', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      () =>
        new BoundedJsonBody(circular, {
          maxChunkBytes: 8,
          maxEnvelopeBytes: 1024,
        }),
    ).toThrow(TypeError);
  });
});

const everyControlCharacter = Array.from({ length: 0x20 }, (_, code) =>
  String.fromCharCode(code),
).join('');

const chunkApiCases: ReadonlyArray<readonly [string, unknown]> = [
  ['a lone high surrogate', { text: 'before \ud83d after' }],
  ['a lone low surrogate', { text: 'before \ude00 after' }],
  ['a valid surrogate pair', { text: 'pair \ud83d\ude00 end' }],
  ['a lone surrogate at the end of a string', ['tail \ud800']],
  ['U+2028 and U+2029', { text: 'line\u2028para\u2029end' }],
  ['control characters and DEL', { text: `${everyControlCharacter}\u007f` }],
  ['quotes and backslashes', { text: 'say "hi" \\ path\\to' }],
  [
    'integer-like keys among string keys',
    { b: 1, 2: 'two', 1: 'one', a: 2, '-1': 3, '01': 4, 10: 'ten' },
  ],
  [
    'undefined, function and symbol members',
    {
      kept: 1,
      gone: undefined,
      fn: () => 1,
      sym: Symbol('s'),
      nested: { gone: undefined, kept: 'x' },
    },
  ],
  [
    'undefined, function and symbol array elements',
    [1, undefined, () => 1, Symbol('s'), 'x'],
  ],
  [
    'a toJSON that returns undefined for a member',
    { kept: 1, omitted: { toJSON: () => undefined } },
  ],
  ['non-finite numbers and negative zero', [Number.NaN, -0, 1e21, 0.1]],
  ['boxed primitives', [new Number(3), new String('s'), new Boolean(false)]],
  ['null, booleans and empty containers', [null, true, false, {}, []]],
  ['a Date', { when: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) }],
  ['a bare string', 'plain "string"'],
  ['a bare number', 42],
];

async function streamFormBytes(
  value: unknown,
  maxChunkBytes: number,
): Promise<Uint8Array> {
  const body = new BoundedJsonBody(value, {
    maxChunkBytes,
    maxEnvelopeBytes: DEFAULT_STREAMING_JSON_CHUNK_BYTES * 4,
  });
  return readBody(body.createStream());
}

function drainChunks(chunks: Generator<Uint8Array, void, unknown>): {
  readonly bytes: Uint8Array;
  readonly largestChunk: number;
} {
  const kept: Uint8Array[] = [];
  let largestChunk = 0;
  for (const chunk of chunks) {
    kept.push(chunk);
    largestChunk = Math.max(largestChunk, chunk.byteLength);
  }
  return { bytes: new Uint8Array(Buffer.concat(kept)), largestChunk };
}

describe('jsonValueChunks', () => {
  it.each(chunkApiCases)(
    'yields the bytes of JSON.stringify and of the stream form for %s',
    async (_name, value) => {
      const expected = new TextEncoder().encode(JSON.stringify(value));
      for (const maxChunkBytes of [5, 17, DEFAULT_STREAMING_JSON_CHUNK_BYTES]) {
        const chunks = jsonValueChunks(value, { maxChunkBytes });
        if (chunks === undefined) throw new Error('Expected serializable');

        const drained = drainChunks(chunks);

        expect(drained.bytes).toStrictEqual(expected);
        expect(drained.largestChunk).toBeLessThanOrEqual(maxChunkBytes);
        expect(await streamFormBytes(value, maxChunkBytes)).toStrictEqual(
          expected,
        );
      }
    },
  );

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('s')],
    ['a toJSON returning undefined', { toJSON: () => undefined }],
  ])('is undefined, like JSON.stringify, for %s', (_name, value) => {
    expect(JSON.stringify(value)).toBeUndefined();
    expect(jsonValueChunks(value)).toBeUndefined();
  });

  it('passes the member key to toJSON as JSON.stringify does', () => {
    const value = { toJSON: (key: string) => `key:${key}` };
    const expected = new TextEncoder().encode(
      JSON.stringify({ member: value }),
    );
    const chunks = jsonValueChunks(value, { key: 'member' });
    if (chunks === undefined) throw new Error('Expected serializable');

    const text = new TextDecoder().decode(drainChunks(chunks).bytes);

    expect(text).toBe('"key:member"');
    expect(new TextDecoder().decode(expected)).toBe('{"member":"key:member"}');
  });

  it('hands out chunks that stay intact after later chunks are produced', () => {
    const value = { text: 'abcdefghij'.repeat(50) };
    const chunks = jsonValueChunks(value, { maxChunkBytes: 7 });
    if (chunks === undefined) throw new Error('Expected serializable');
    const first = chunks.next();
    if (first.done === true) throw new Error('Expected a chunk');
    const snapshot = Array.from(first.value);

    drainChunks(chunks);

    expect(Array.from(first.value)).toStrictEqual(snapshot);
  });

  it('rejects values JSON.stringify rejects', () => {
    expect(() => jsonValueChunks({ big: 1n })).toThrow(
      'Do not know how to serialize a BigInt',
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => jsonValueChunks(circular)).toThrow(
      'Converting circular structure to JSON',
    );
  });

  it('rejects a zero chunk limit', () => {
    expect(() => jsonValueChunks({ a: 1 }, { maxChunkBytes: 0 })).toThrow(
      'JSON streaming chunk limit is zero',
    );
  });
});
