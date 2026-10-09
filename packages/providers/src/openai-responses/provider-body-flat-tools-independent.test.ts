/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';

const toolSchema = {
  type: 'object',
  properties: {
    sentinel: { const: 'wire-tool-declaration-sentinel' },
    nested: {
      type: 'object',
      properties: {
        value: { type: ['string', 'null'], enum: ['value', null] },
      },
      required: ['value'],
      additionalProperties: false,
    },
    branch: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
  },
  required: ['sentinel', 'nested', 'branch'],
  additionalProperties: false,
};

function rowText(index: number, padding: number): string {
  return `row-${index}:"\\\n雪🧪:${'x'.repeat(padding)}`;
}

function source(rows: number, padding: number) {
  let pulled = 0;
  let opens = 0;
  let closed = false;
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      opens += 1;
      try {
        for (let index = 0; index < rows; index += 1) {
          pulled += 1;
          yield {
            speaker: index % 2 === 0 ? 'human' : 'ai',
            blocks: [{ type: 'text', text: rowText(index, padding) }],
          };
        }
      } finally {
        closed = true;
      }
    },
  };
  return { contents, state: () => ({ pulled, opens, closed }) };
}

function expectedBody(rows: number, padding: number): string {
  return JSON.stringify({
    model: 'o3-mini',
    input: Array.from({ length: rows }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: rowText(index, padding),
    })),
    stream: true,
    instructions: 'Inspect the supplied rows.',
    tools: [
      {
        type: 'function',
        name: 'declaration_sentinel',
        description: 'Inspect structured values',
        parameters: toolSchema,
        strict: null,
      },
    ],
    tool_choice: 'auto',
    parallel_tool_calls: true,
  });
}

async function readWire(
  init: RequestInit | undefined,
  history: ReturnType<typeof source>,
): Promise<string> {
  expect(history.state()).toStrictEqual({ pulled: 0, opens: 0, closed: false });
  expect(activeRequestBodyCount()).toBe(1);
  if (init?.body === null || init?.body === undefined)
    throw new Error('Missing request BODY');
  const body = new Response(init.body).body;
  if (body === null) throw new Error('Missing BODY stream');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let maxChunk = 0;
  let row = await reader.read();
  while (!row.done) {
    maxChunk = Math.max(maxChunk, row.value.byteLength);
    expect(activeRequestBodyCount()).toBe(1);
    chunks.push(decoder.decode(row.value, { stream: true }));
    row = await reader.read();
  }
  chunks.push(decoder.decode());
  expect(maxChunk).toBeGreaterThan(0);
  expect(maxChunk).toBeLessThanOrEqual(64 * 1024);
  expect(activeRequestBodyCount()).toBe(1);
  return chunks.join('');
}

function makeBodyRuntime() {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'o3-mini');
  const config = new Config({
    sessionId: 'independent-flat-body',
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    model: 'o3-mini',
    settingsService: settings,
  });
  const runtime = {
    settingsService: settings,
    config,
    runtimeId: 'independent-flat-body',
  };
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: { 'prompt-caching': 'off' },
  });
  return { settings, config, runtime, invocation };
}

async function runBody(rows: number, padding: number): Promise<number> {
  const { settings, config, runtime, invocation } = makeBodyRuntime();
  const history = source(rows, padding);
  const originalFetch = globalThis.fetch;
  let wire = '';
  globalThis.fetch = Object.assign(
    async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      wire = await readWire(init, history);
      return new Response(
        'data: {"type":"response.completed","response":{"id":"resp_independent","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    const provider = new OpenAIResponsesProvider(
      'test-key',
      'https://body.invalid/v1',
    );
    const request = provider.generateChatCompletion({
      contents: history.contents,
      settings,
      config,
      runtime,
      invocation,
      systemInstruction: 'Inspect the supplied rows.',
      tools: [
        {
          name: 'declaration_sentinel',
          description: 'Inspect structured values',
          parametersJsonSchema: toolSchema,
        },
      ],
    });
    await Promise.resolve();
    expect(history.state()).toStrictEqual({
      pulled: 0,
      opens: 0,
      closed: false,
    });
    for await (const _row of request) {
      void _row;
    }
    const expected = expectedBody(rows, padding);
    const digest = (value: string): string =>
      createHash('sha256').update(value).digest('hex');
    expect(digest(wire)).toBe(digest(expected));
    expect(wire.length).toBe(expected.length);
    expect(JSON.parse(wire)).toStrictEqual(JSON.parse(expected));
    expect(history.state()).toStrictEqual({
      pulled: rows,
      opens: 1,
      closed: true,
    });
    expect(activeRequestBodyCount()).toBe(0);
    if (padding > 0)
      expect(Buffer.byteLength(wire)).toBeGreaterThan(9 * 1024 * 1024);
    return history.state().pulled;
  } finally {
    globalThis.fetch = originalFetch;
    await config.dispose();
  }
}

describe('independent real provider first-pull BODY and flat declaration sentinels', () => {
  it.each([
    [512, 0],
    [8192, 0],
    [8192, 1200],
  ])(
    'preserves exact JSON bytes for %s rows with %s padding',
    async (rows, padding) => {
      expect(await runBody(rows, padding)).toBe(rows);
    },
  );
});
