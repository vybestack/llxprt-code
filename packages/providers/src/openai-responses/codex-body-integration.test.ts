/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';

function makeBodyRuntime() {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'o3-mini');
  const config = new Config({
    sessionId: 'critical-body',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'o3-mini',
    settingsService: settings,
  });
  const runtime = {
    settingsService: settings,
    config,
    runtimeId: 'critical-body',
  };
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: { 'prompt-caching': 'off' },
  });
  return { settings, config, runtime, invocation };
}

async function transportBody(
  schema: Record<string, unknown>,
): Promise<unknown[]> {
  const { settings, config, runtime, invocation } = makeBodyRuntime();
  let pulled = 0;
  let closed = false;
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      try {
        pulled += 1;
        yield {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first-pull-sentinel' }],
        };
      } finally {
        closed = true;
      }
    },
  };
  const oldFetch = globalThis.fetch;
  let wire = '';
  globalThis.fetch = Object.assign(
    async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      expect(pulled).toBe(0);
      if (init?.body === undefined || init.body === null)
        throw new Error('Missing streamed body');
      wire = await new Response(init.body).text();
      return new Response(
        'data: {"type":"response.completed","response":{"id":"resp_seam","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    },
    { preconnect: oldFetch.preconnect },
  );
  try {
    const provider = new OpenAIResponsesProvider(
      'test-key',
      'https://transport.invalid/v1',
    );
    const stream = provider.generateChatCompletion({
      contents,
      settings,
      config,
      runtime,
      invocation,
      systemInstruction: 'You inspect values supplied by the user.',
      tools: [
        {
          name: 'inspect',
          description: 'Inspect values',
          parametersJsonSchema: schema,
        },
      ],
    });
    await Promise.resolve();
    expect(pulled).toBe(0);
    for await (const row of stream) {
      void row;
    }
    expect(wire).toContain('first-pull-sentinel');
    expect(pulled).toBe(1);
    expect(closed).toBe(true);
    expect(activeRequestBodyCount()).toBe(0);
    const body: unknown = JSON.parse(wire);
    if (
      typeof body !== 'object' ||
      body === null ||
      !('tools' in body) ||
      !Array.isArray(body.tools)
    )
      throw new Error('Missing wire tools');
    return body.tools;
  } finally {
    globalThis.fetch = oldFetch;
    await config.dispose();
  }
}

function expectedTool(schema: Record<string, unknown>): unknown[] {
  return [
    {
      type: 'function',
      name: 'inspect',
      description: 'Inspect values',
      parameters: schema,
      strict: null,
    },
  ];
}

describe('Codex identity and streamed BODY integration', () => {
  it('uses constructor identity even when endpoint URLs suggest a different mode', () => {
    const codex = new OpenAIResponsesProvider(
      'test-key',
      'https://gateway.invalid/v1',
      undefined,
      undefined,
      [],
      'codex',
    );
    const ordinary = new OpenAIResponsesProvider(
      'test-key',
      'https://chatgpt.com/backend-api/codex',
    );
    expect(codex.getDefaultModel()).toBe('gpt-5.6-sol');
    expect(ordinary.getDefaultModel()).toBe('o3-mini');
  });

  it('keeps history cold until HTTP BODY pull, closes it, and releases the BODY lease', async () => {
    const schema = {
      type: 'object',
      properties: { value: { type: 'integer', minimum: 0 } },
      required: ['value'],
    };
    expect(await transportBody(schema)).toStrictEqual(expectedTool(schema));
  });

  it('preserves closed nested object schemas on the real BODY path', async () => {
    const schema = {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { value: { type: 'integer', minimum: 0 } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      required: ['nested'],
      additionalProperties: false,
    };
    expect(await transportBody(schema)).toStrictEqual(expectedTool(schema));
  });

  it('preserves all neutral schema branches on the real BODY path', async () => {
    const schema = {
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
      required: ['value'],
      additionalProperties: false,
    };
    expect(await transportBody(schema)).toStrictEqual(expectedTool(schema));
  });
});
