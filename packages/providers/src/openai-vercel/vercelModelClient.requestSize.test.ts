/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * The Vercel provider reports the byte length of the JSON body the AI SDK
 * posts, measured at the fetch it hands the SDK, on endpoints with and without
 * the Qwen developer-role compatibility wrapper.
 */

import { describe, expect, it } from 'bun:test';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createOpenAIClient } from './vercelModelClient.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { REQUEST_SIZE_SINK_KEY } from '../logging/requestSizeReport.js';

function chatCompletion(): Response {
  return Response.json({
    id: 'chatcmpl-size',
    object: 'chat.completion',
    created: 1,
    model: 'size-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function optionsFor(
  baseURL: string,
  reported: number[],
): NormalizedGenerateChatOptions {
  return {
    invocation: createRuntimeInvocationContext({
      fetch: (input, init) => globalThis.fetch(input, init),
      runtimeId: 'request-size',
      providerName: 'openaivercel',
      ephemeralsSnapshot: {},
    }),
    metadata: {
      [REQUEST_SIZE_SINK_KEY]: (bytes: number) => reported.push(bytes),
    },
    resolved: {
      model: 'size-model',
      baseURL,
      authToken: 'test-key',
      streaming: false,
    },
  } as unknown as NormalizedGenerateChatOptions;
}

async function postedBodies(baseURL: string, reported: number[]) {
  const bodies: string[] = [];
  const transport = Object.assign(
    (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body !== 'string') throw new Error('Expected a string');
      bodies.push(init.body);
      return Promise.resolve(chatCompletion());
    },
    { preconnect: () => undefined },
  );
  const client = await createOpenAIClient(
    optionsFor(baseURL, reported),
    {
      baseURL,
      providerName: 'openaivercel',
      requiresAuth: true,
      customHeaders: undefined,
    },
    transport,
  );
  await client.chat('size-model').doGenerate({
    prompt: [
      { role: 'system', content: 'Be brief.' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'héllo 😀 日本語' }],
      },
    ],
  });
  return bodies;
}

describe('openai-vercel request size report', () => {
  it('reports the UTF-8 byte length of the posted body', async () => {
    const reported: number[] = [];

    const bodies = await postedBodies('https://api.example.test/v1', reported);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].length).toBeLessThan(Buffer.byteLength(bodies[0]));
    expect(reported).toStrictEqual([Buffer.byteLength(bodies[0])]);
  });

  it('reports the posted body on a Qwen endpoint', async () => {
    const reported: number[] = [];

    const bodies = await postedBodies(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      reported,
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('"role":"system"');
    expect(bodies[0]).not.toContain('"role":"developer"');
    expect(reported).toStrictEqual([Buffer.byteLength(bodies[0])]);
  });
});
