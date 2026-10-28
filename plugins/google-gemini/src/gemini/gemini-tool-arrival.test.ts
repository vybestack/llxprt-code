/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { createGeminiApiClient } from './geminiApiClientFactory.js';
import { createGeminiResponseMapper } from './geminiResponseMapper.js';
import {
  expected,
  runDiskArrival,
} from '../../../../packages/providers/src/__tests__/tool-arrival-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const fragments = [
  {
    id: 'call_frozen',
    name: 'lookup',
    partialArgs: [{ jsonPath: '$.path', stringValue: 'a', willContinue: true }],
    willContinue: true,
  },
  {
    partialArgs: [{ jsonPath: '$.path', stringValue: '\nb' }],
    willContinue: true,
  },
  {
    partialArgs: [{ jsonPath: '$.count', numberValue: 2 }],
    willContinue: true,
  },
];
const prefixes = ['{"path":"a', '\\nb', '","count":2'];

async function* source(
  gate: (index: number) => Promise<void>,
): AsyncGenerator<IContent> {
  let failure: unknown;
  globalThis.fetch = Object.assign(
    async (): Promise<Response> => {
      let index = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller): Promise<void> {
            if (index > 0 && index <= fragments.length) {
              try {
                await gate(index - 1);
              } catch (error) {
                failure = error;
                controller.error(error);
                return;
              }
            }
            if (index > fragments.length) {
              controller.close();
              return;
            }
            const functionCall = fragments[index++] ?? {};
            const frame = {
              candidates: [
                { content: { role: 'model', parts: [{ functionCall }] } },
              ],
            };
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`),
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
    { preconnect() {} },
  );
  try {
    const client = await createGeminiApiClient({ apiKey: 'test' });
    const stream = await client.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: 'hi',
    });
    const mapper = createGeminiResponseMapper();
    for await (const response of stream) yield* mapper(response);
    if (failure !== undefined) throw failure;
  } catch (error) {
    throw failure ?? error;
  }
}

describe('Gemini tool argument disk arrival', () => {
  it('records argument pieces before completion and preserves finalized parity', async () => {
    expect(await runDiskArrival(source, false, prefixes)).toStrictEqual([
      expected,
    ]);
  });
  it('rejects a retaining argument control', async () => {
    await expect(runDiskArrival(source, true, prefixes)).rejects.toThrow(
      'Argument disk-progress gate failed',
    );
  });
});
