/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';

function historySource() {
  let opened = 0;
  let pulled = 0;
  let closed = false;
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      opened += 1;
      try {
        for (let index = 0; index < 512; index += 1) {
          pulled += 1;
          yield {
            speaker: 'human',
            blocks: [{ type: 'text', text: `${index}:${'x'.repeat(70_000)}` }],
          };
        }
      } finally {
        closed = true;
      }
    },
  };
  return { contents, state: () => ({ opened, pulled, closed }) };
}

const schema = {
  type: 'object',
  properties: { nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
  required: ['nullable'],
  additionalProperties: false,
};

function optionsFor(contents: AsyncIterable<IContent>, signal: AbortSignal) {
  return streamCallOptions({
    providerName: 'openai-responses',
    contents,
    metadata: { abortSignal: signal },
    settingsOverrides: {
      provider: { model: 'o3-mini', 'prompt-caching': 'off' },
    },
    tools: [{ name: 'inspect_values', parametersJsonSchema: schema }],
    systemInstruction: 'Inspect values.',
  });
}

async function captureBody(
  init: RequestInit | undefined,
  history: ReturnType<typeof historySource>,
): Promise<void> {
  expect(history.state()).toStrictEqual({
    opened: 0,
    pulled: 0,
    closed: false,
  });
  expect(activeRequestBodyCount()).toBe(1);
  if (!(init?.body instanceof ReadableStream))
    throw new Error('Expected streamed BODY');
  const wire: unknown = JSON.parse(await new Response(init.body).text());
  expect(wire).toMatchObject({
    tools: [
      {
        type: 'function',
        name: 'inspect_values',
        parameters: schema,
        strict: null,
      },
    ],
    tool_choice: 'auto',
  });
  if (
    typeof wire !== 'object' ||
    wire === null ||
    !('input' in wire) ||
    !Array.isArray(wire.input)
  ) {
    throw new Error('Expected input rows');
  }
  expect(wire.input).toHaveLength(512);
  expect(wire.input[511]).toStrictEqual({
    role: 'user',
    content: `511:${'x'.repeat(70_000)}`,
  });
}

async function cancelBody(
  init: RequestInit | undefined,
  history: ReturnType<typeof historySource>,
  controller: AbortController,
  pulls: number,
  readAbort: boolean,
): Promise<never> {
  expect(history.state()).toStrictEqual({
    opened: 0,
    pulled: 0,
    closed: false,
  });
  expect(activeRequestBodyCount()).toBe(1);
  if (!(init?.body instanceof ReadableStream))
    throw new Error('Expected streamed BODY');
  const reader = init.body.getReader();
  let bytes = 0;
  for (let pull = 0; pull < pulls; pull += 1) {
    const next = await reader.read();
    expect(next.done).toBe(false);
    bytes += next.value?.byteLength ?? 0;
    if (pull === 3) {
      expect(new TextDecoder().decode(next.value).endsWith('x')).toBe(true);
    }
    expect(history.state().pulled).toBe(1);
  }
  controller.abort(new DOMException('BODY cancelled', 'AbortError'));
  if (readAbort) {
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
  } else {
    await reader.cancel(controller.signal.reason);
    expect((await reader.read()).done).toBe(true);
  }
  expect(history.state()).toMatchObject({ pulled: 1 });
  expect(bytes).toBeGreaterThan(0);
  throw controller.signal.reason;
}

async function runProvider(
  cancel: boolean,
  pulls = 1,
  readAbort = false,
): Promise<ReturnType<ReturnType<typeof historySource>['state']>> {
  const history = historySource();
  const controller = new AbortController();
  const options = optionsFor(history.contents, controller.signal);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      if (cancel)
        return cancelBody(init, history, controller, pulls, readAbort);
      await captureBody(init, history);
      return new Response(
        'data: {"type":"response.completed","response":{"id":"helper_response","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    const provider = new OpenAIResponsesProvider(
      'test-key',
      'https://body.invalid/v1',
    );
    const drain = async (): Promise<void> => {
      for await (const row of provider.generateChatCompletion(options))
        void row;
    };
    if (cancel) {
      await expect(drain()).rejects.toMatchObject({ name: 'AbortError' });
    } else {
      await drain();
    }
    expect(activeRequestBodyCount()).toBe(0);
    return history.state();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('real Responses BODY through relocated helper', () => {
  it('carries cold history and full flat declarations into BODY bytes', async () => {
    expect(await runProvider(false)).toStrictEqual({
      opened: 1,
      pulled: 512,
      closed: true,
    });
  });
  it('closes producer and releases the BODY lease without draining all rows on cancellation', async () => {
    const state = await runProvider(true);
    expect(state.opened).toBe(1);
    expect(state.closed).toBe(true);
    expect(state.pulled).toBeLessThan(512);
  });
  it('cancels inside a large input part without pulling the next history row', async () => {
    expect(await runProvider(true, 4)).toStrictEqual({
      opened: 1,
      pulled: 1,
      closed: true,
    });
  });
  it('stops a mid-part upload on the signal without a transport reader cancel', async () => {
    expect(await runProvider(true, 4, true)).toStrictEqual({
      opened: 1,
      pulled: 1,
      closed: true,
    });
  });
});
