/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  ProgressiveJsonBody,
  jsonValueBytes,
} from './progressive-json-body.js';
import {
  DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  DEFAULT_STREAMING_JSON_CHUNK_BYTES,
} from './boundedJsonBody.js';

function source() {
  let pulls = 0;
  let closed = false;
  const bytes = async function* (): AsyncIterable<Uint8Array> {
    try {
      for (let index = 0; index < 512; index += 1) {
        pulls += 1;
        yield Buffer.from(`${index}`);
      }
    } finally {
      closed = true;
    }
  };
  return { bytes, state: () => ({ pulls, closed }) };
}

describe('progressive JSON ownership and demand', () => {
  it('does not prefetch before a read or while its consumer is idle', async () => {
    const history = source();
    const body = new ProgressiveJsonBody(history.bytes);
    const handle = body.createStreamHandle();
    const reader = handle.stream.getReader();
    expect(history.state()).toStrictEqual({ pulls: 0, closed: false });
    const next = await reader.read();
    expect(Buffer.from(next.value ?? []).toString()).toBe('0');
    expect(history.state()).toStrictEqual({ pulls: 1, closed: false });
    await Bun.sleep(0);
    expect(history.state().pulls).toBe(1);
    await body.dispose();
    await body.dispose();
    expect((await reader.read()).done).toBe(true);
    expect(history.state()).toStrictEqual({ pulls: 1, closed: true });
    expect(() => body.createStreamHandle()).toThrow(
      'JSON request body was disposed',
    );
  });

  it('cancels an unopened stream without opening the producer', async () => {
    const history = source();
    const body = new ProgressiveJsonBody(history.bytes);
    const handle = body.createStreamHandle();
    await handle.dispose();
    const reader = handle.stream.getReader();
    expect((await reader.read()).done).toBe(true);
    expect(history.state()).toStrictEqual({ pulls: 0, closed: false });
    await body.dispose();
  });

  it('surfaces a producer failure and closes its owner', async () => {
    let closed = false;
    const body = new ProgressiveJsonBody(async function* () {
      try {
        yield Buffer.from('prefix');
        throw new Error('serialization failed');
      } finally {
        closed = true;
      }
    });
    const reader = body.createStreamHandle().stream.getReader();
    await reader.read();
    await expect(reader.read()).rejects.toThrow('serialization failed');
    expect(closed).toBe(true);
    await body.dispose();
  });
});

describe('progressive JSON byte contracts', () => {
  it('keeps bounded chunks byte-identical across escapes and surrogate pairs', async () => {
    const value = {
      text: `${'雪🧪"\\\n'.repeat(50_000)}\ud800`,
      nested: [false, null, 42],
    };
    const body = new ProgressiveJsonBody(() => jsonValueBytes(value));
    const handle = body.createStreamHandle();
    const reader = handle.stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      expect(next.value.byteLength).toBeLessThanOrEqual(
        DEFAULT_STREAMING_JSON_CHUNK_BYTES,
      );
      chunks.push(next.value);
    }
    expect(Buffer.concat(chunks).toString()).toBe(JSON.stringify(value));
    await body.dispose();
  });

  it('rejects the cumulative envelope limit even when each part is bounded', async () => {
    let closed = false;
    const body = new ProgressiveJsonBody(async function* () {
      const chunk = new Uint8Array(DEFAULT_STREAMING_JSON_CHUNK_BYTES);
      try {
        for (
          let index = 0;
          index <= DEFAULT_HTTP_JSON_ENVELOPE_BYTES / chunk.byteLength;
          index += 1
        )
          yield chunk;
      } finally {
        closed = true;
      }
    });
    const reader = body.createStreamHandle().stream.getReader();
    const drain = async (): Promise<void> => {
      while (!(await reader.read()).done) {
        /* Consume without retaining bytes. */
      }
    };
    await expect(drain()).rejects.toThrow(
      'JSON request envelope exceeds byte limit',
    );
    expect(closed).toBe(true);
    await body.dispose();
  });
});
