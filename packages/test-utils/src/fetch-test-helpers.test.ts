/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { withFetchPreconnect } from './fetch-test-helpers.js';

const nativeFetch = globalThis.fetch;

function digest(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('fetch fixture streamed body', () => {
  it('streams the complete body above 9 MiB through a preconnected real transport', async () => {
    const body = 'streamed-μ-body\n'.repeat(700_000);
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request): Promise<Response> {
        const received = await request.text();
        return new Response(digest(received), {
          headers: { 'x-body-bytes': String(Buffer.byteLength(received)) },
        });
      },
    });
    try {
      const transport = withFetchPreconnect(
        (...args: Parameters<typeof fetch>) => nativeFetch(...args),
      );
      transport.preconnect(server.url);
      const bytes = new TextEncoder().encode(body);
      let position = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller): void {
          if (position === bytes.length) {
            controller.close();
            return;
          }
          const end = Math.min(position + 65536, bytes.length);
          controller.enqueue(bytes.subarray(position, end));
          position = end;
        },
      });
      const response = await transport(server.url, {
        method: 'POST',
        body: stream,
      });
      expect(Buffer.byteLength(body)).toBeGreaterThan(9 * 1024 * 1024);
      expect(Number(response.headers.get('x-body-bytes'))).toBe(
        Buffer.byteLength(body),
      );
      expect(await response.text()).toBe(digest(body));
    } finally {
      await server.stop(true);
    }
  });
});

describe('fetch fixture native preconnect', () => {
  it('preserves native URL validation on preconnect', () => {
    const transport = withFetchPreconnect((...args: Parameters<typeof fetch>) =>
      nativeFetch(...args),
    );
    expect(() => transport.preconnect('not a url')).toThrow(TypeError);
  });
});

describe('fetch fixture aborted request', () => {
  it('preserves aborted request rejection without converting it to a response', async () => {
    const transport = withFetchPreconnect((...args: Parameters<typeof fetch>) =>
      nativeFetch(...args),
    );
    const controller = new AbortController();
    const reason = new Error('request cancelled before transport');
    controller.abort(reason);
    await expect(
      transport('http://127.0.0.1:1', { signal: controller.signal }),
    ).rejects.toBe(reason);
  });
});

describe('fetch fixture aborted response', () => {
  it('rejects response consumption when a real streamed request is cancelled', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(): Response {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(new TextEncoder().encode('pending response'));
            },
          }),
        );
      },
    });
    try {
      const transport = withFetchPreconnect(
        (...args: Parameters<typeof fetch>) => nativeFetch(...args),
      );
      const controller = new AbortController();
      const response = await transport(server.url, {
        signal: controller.signal,
      });
      const reading = response.text();
      controller.abort();
      await expect(reading).rejects.toBeInstanceOf(Error);
    } finally {
      await server.stop(true);
    }
  });
});
