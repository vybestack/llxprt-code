/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, expect, it } from 'bun:test';
import { gc, sleep } from 'bun';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { GeminiProvider } from './GeminiProvider.js';
import { createProviderCallOptions } from '../test/testSupport.js';

import { createGeminiApiClient } from './geminiApiClientFactory.js';

it('streams direct-client caller-owned contents through the same body builder', async () => {
  let body = '';
  globalThis.fetch = Object.assign(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (!(init?.body instanceof ReadableStream))
        throw new Error('Expected streamed direct-client body');
      body = await new Response(init.body).text();
      return Response.json({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          },
        ],
      });
    },
    { preconnect() {} },
  );
  const client = await createGeminiApiClient({ apiKey: 'test' });
  const response = await client.models.generateContent({
    model: 'gemini-3.7-flash',
    contents: [{ role: 'user', parts: [{ text: 'direct caller' }] }],
  });
  expect(body).toContain('direct caller');
  expect(response.candidates?.[0]?.content?.parts?.[0]?.text).toBe('ok');
});
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('streams 25000 Gemini rows with bounded live rows and no full-body string', async () => {
  const count = 25000;
  let pulled = 0;
  let consumed = 0;
  let bytes = 0;
  const refs: WeakRef<IContent>[] = [];
  const row = (index: number): IContent => ({
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `${index}:` + 'g'.repeat(2700) }],
  });
  globalThis.fetch = Object.assign(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(pulled).toBe(0);
      if (!(init?.body instanceof ReadableStream))
        throw new Error('Expected streamed Gemini body');
      const reader = init.body.getReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          consumed = pulled;
          if (refs.length >= 1000) {
            await sleep(0);
            gc(true);
            expect(
              refs.filter((ref) => ref.deref() !== undefined).length,
            ).toBeLessThan(20);
            refs.splice(0);
          }
        }
      } finally {
        reader.releaseLock();
      }
      return Response.json({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      });
    },
    {
      preconnect: (url: string | URL) => {
        const preconnect: unknown = Reflect.get(originalFetch, 'preconnect');
        if (typeof preconnect === 'function')
          Reflect.apply(preconnect, originalFetch, [url]);
      },
    },
  );
  const options = createProviderCallOptions({
    providerName: 'gemini',
    contents: {
      [Symbol.asyncIterator](): AsyncGenerator<IContent> {
        throw new Error('Unexpected contents read');
      },
    },
    ephemerals: { streaming: 'disabled' },
  });
  const requestRows = {
    count,
    async *openReader(): AsyncGenerator<IContent> {
      for (let index = 0; index < count; index++) {
        if (pulled > consumed + 1) throw new Error('BUFFERING_TRAP');
        const next = row(index);
        refs.push(new WeakRef(next));
        pulled++;
        yield next;
      }
    },
    readAt: row,
    close() {},
  };
  for await (const _chunk of new GeminiProvider('test').generateChatCompletion({
    ...options,
    requestRows,
    contentCount: count,
  })) {
    /* consume */
  }
  expect(pulled).toBe(count);
  expect(bytes).toBeGreaterThan(65_000_000);
  const retained = Array.from({ length: 100 }, (_, index) => row(index));
  const controlRefs = retained.map((value) => new WeakRef(value));
  gc(true);
  expect(() =>
    expect(
      controlRefs.filter((ref) => ref.deref() !== undefined).length,
    ).toBeLessThan(20),
  ).toThrow();
  expect(retained.length).toBe(100);
});

const parityRows: IContent[] = [
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'look\n東京' },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'call_x',
        name: 'lookup',
        parameters: { city: 'Paris' },
      },
      {
        type: 'tool_call',
        id: 'call_y',
        name: 'lookup',
        parameters: { city: 'London' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_x',
        toolName: 'lookup',
        result: { temperature: 21 },
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'continue' }] },
];

for (const model of ['gemini-2.5-pro', 'gemini-3.7-flash', 'gemma-3-27b-it']) {
  for (const streaming of [false, true]) {
    it(`preserves the HEAD SDK request bytes for ${model}, streaming=${streaming}`, async () => {
      const bodies: string[] = [];
      const reply = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      };
      globalThis.fetch = Object.assign(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          bodies.push(await new Response(init?.body).text());
          return streaming
            ? new Response(`data: ${JSON.stringify(reply)}\n\n`, {
                headers: { 'content-type': 'text/event-stream' },
              })
            : Response.json(reply);
        },
        { preconnect() {} },
      );
      const options = createProviderCallOptions({
        providerName: 'gemini',
        contents: {
          async *[Symbol.asyncIterator]() {
            yield* parityRows;
          },
        },
        ephemerals: { streaming: streaming ? 'enabled' : 'disabled' },
        resolved: { model },
        tools: [
          {
            name: 'lookup',
            description: 'lookup',
            parametersJsonSchema: {
              type: 'object',
              properties: { city: { type: 'string', pattern: '^[A-Z]' } },
            },
          },
        ],
      });
      const provider = new GeminiProvider('test');
      for await (const _chunk of provider.generateChatCompletion(options)) {
        /* consume */
      }
      for await (const _chunk of provider.generateChatCompletion({
        ...options,
        requestRows: {
          count: parityRows.length,
          async *openReader() {
            yield* parityRows;
          },
          readAt: (index: number) => parityRows[index],
          close() {},
        },
        contentCount: parityRows.length,
      })) {
        /* consume */
      }
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(bodies[1]).toContain('functionResponse');
      expect(bodies[1]).toContain('pattern');
    });
  }
}
