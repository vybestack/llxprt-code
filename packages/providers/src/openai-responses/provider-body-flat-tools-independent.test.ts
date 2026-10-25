/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { diskAdmittedSource } from '../__tests__/support/disk-admitted-source.js';
import { createHash } from 'node:crypto';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { readdirSync } from 'node:fs';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

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

/** Scratch entries a request creates: staged rows and prompt-key files. */
function requestScratchEntries(): string[] {
  return readdirSync(getScratchRoot())
    .filter(
      (name) =>
        name.startsWith('provider-normalization-') ||
        name.startsWith('responses-prompt-keys-'),
    )
    .sort();
}

function rowText(index: number, padding: number): string {
  return `row-${index}:"\\\n雪🧪:${'x'.repeat(padding)}`;
}

function source(rows: number, padding: number) {
  let pulled = 0;
  let opens = 0;
  let closed = false;
  const sourceRows: Iterable<IContent> = {
    *[Symbol.iterator]() {
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
  return {
    ...diskAdmittedSource(sourceRows),
    state: () => ({ pulled, opens, closed }),
  };
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
  rows: number,
): Promise<string> {
  // The length is declared from the staged rows, so every row is read and the
  // source closed before the first BODY byte.
  expect(history.state()).toStrictEqual({
    pulled: rows,
    opens: 1,
    closed: true,
  });
  expect(requestScratchEntries()).toStrictEqual([]);
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
    chunks.push(decoder.decode(row.value, { stream: true }));
    row = await reader.read();
  }
  chunks.push(decoder.decode());
  expect(maxChunk).toBeGreaterThan(0);
  expect(maxChunk).toBeLessThanOrEqual(64 * 1024);
  return chunks.join('');
}

function makeBodyRuntime() {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'o3-mini');
  settings.set('prompt-caching', 'off');
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'independent-flat-body',
  });
  return { invocation: captureProviderInvocation(runtime, 'openai-responses') };
}

async function runBody(rows: number, padding: number): Promise<number> {
  const { invocation } = makeBodyRuntime();
  const history = source(rows, padding);
  const scratchBefore = requestScratchEntries();
  const originalFetch = globalThis.fetch;
  let wire = '';
  globalThis.fetch = Object.assign(
    async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      wire = await readWire(init, history, rows);
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
    expect(requestScratchEntries()).toStrictEqual(scratchBefore);
    if (padding > 0)
      expect(Buffer.byteLength(wire)).toBeGreaterThan(9 * 1024 * 1024);
    return history.state().pulled;
  } finally {
    globalThis.fetch = originalFetch;
    await history.close();
  }
}

describe('independent real provider staged BODY and flat declaration sentinels', () => {
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
