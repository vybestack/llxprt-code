/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { NativeAnthropicBody } from './native-anthropic-request.js';
import { DEFAULT_HTTP_JSON_ENVELOPE_BYTES } from '../utils/boundedJsonBody.js';

async function* bytes(value: string): AsyncGenerator<Uint8Array> {
  yield Buffer.from(value);
}

async function read(body: NativeAnthropicBody): Promise<string> {
  const handle = body.openStream();
  try {
    return await new Response(handle.stream).text();
  } finally {
    await handle.dispose();
  }
}

describe('native Anthropic HTTP body', () => {
  it('refuses an oversized stored length before opening its source', () => {
    expect(
      () =>
        new NativeAnthropicBody(
          () => bytes('unreachable'),
          DEFAULT_HTTP_JSON_ENVELOPE_BYTES + 1,
        ),
    ).toThrow(
      `JSON request envelope exceeds ${DEFAULT_HTTP_JSON_ENVELOPE_BYTES} bytes`,
    );
  });

  it('reopens the same bytes for independent transport attempts', async () => {
    const body = new NativeAnthropicBody(
      () => bytes('["雪"]'),
      Buffer.byteLength('["雪"]'),
    );
    try {
      expect(await read(body)).toBe('["雪"]');
      expect(await read(body)).toBe('["雪"]');
    } finally {
      await body.dispose();
    }
    expect(() => body.openStream()).toThrow(/disposed/);
  });

  it.each([1, 3])(
    'refuses a source that disagrees with the declared %i bytes',
    async (length) => {
      const body = new NativeAnthropicBody(() => bytes('{}'), length);
      try {
        await expect(read(body)).rejects.toThrow(/served 2 bytes but declared/);
      } finally {
        await body.dispose();
      }
    },
  );
});
