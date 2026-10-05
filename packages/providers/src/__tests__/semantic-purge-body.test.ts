/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-core/services/history/history-suffix-test-helpers.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';

function bodyRow(index: number, bytes: number): IContent {
  const text = {
    type: 'text',
    text: `row-${index}:${'x'.repeat(bytes)}`,
  } as const;
  const group = Math.floor(index / 3);
  const id = `call-${group}`;
  if (index % 3 === 0)
    return {
      speaker: 'human',
      blocks: [
        text,
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aW1hZ2U=',
          caption: `caption-${index}`,
        },
      ],
    };
  if (index % 3 === 1)
    return {
      speaker: 'ai',
      blocks: [
        text,
        { type: 'tool_call', id, name: 'inspect', parameters: { group } },
      ],
    };
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: id,
        toolName: 'inspect',
        result: { group, result: text.text },
      },
    ],
  };
}

function independentInput(size: number, explicit: boolean): unknown[] {
  const input: unknown[] = [];
  for (let index = 0; index < size; index++) {
    const row = bodyRow(index, 2048);
    const first = row.blocks[0];
    if (row.speaker === 'human') {
      if (first.type !== 'text') throw new Error('Expected human text');
      if (index === 0 && !explicit)
        input.push({ role: 'user', content: first.text });
      else
        input.push({
          role: 'user',
          content: [
            { type: 'input_text', text: first.text },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,aW1hZ2U=',
            },
          ],
        });
    } else if (row.speaker === 'ai') {
      if (first.type !== 'text') throw new Error('Expected assistant text');
      input.push({ role: 'assistant', content: first.text });
      input.push({
        type: 'function_call',
        call_id: normalizeToOpenAIToolId(`call-${Math.floor(index / 3)}`),
        name: 'inspect',
        arguments: JSON.stringify({ group: Math.floor(index / 3) }),
      });
      if (index + 1 === size)
        input.push({
          type: 'function_call_output',
          call_id: normalizeToOpenAIToolId(`call-${Math.floor(index / 3)}`),
          output: 'Tool execution cancelled by user',
        });
    } else {
      if (first.type !== 'tool_response')
        throw new Error('Expected tool result');
      input.push({
        type: 'function_call_output',
        call_id: normalizeToOpenAIToolId(first.callId),
        output: JSON.stringify(first.result),
      });
    }
  }
  return input;
}

function response(): Response {
  return new Response(
    'data: {"type":"response.completed","response":{"id":"semantic-purge","status":"completed"}}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

async function captureBody(rows: AsyncIterable<IContent>): Promise<string> {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'gpt-5.2');
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'semantic-purge-body',
    config: createRuntimeConfigStub(settings),
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: { 'prompt-caching': 'off' },
  });
  const options = createProviderCallOptions({
    providerName: 'openai-responses',
    settings,
    config: runtime.config,
    runtime,
    invocation,
    contents: rows,
  });
  const provider = new OpenAIResponsesProvider(
    'test-key',
    'https://api.openai.com/v1',
  );
  const original = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (init?.body === undefined || init.body === null)
      throw new Error('Missing body');
    bodies.push(await new Response(init.body).text());
    return response();
  };
  try {
    for await (const _chunk of provider.generateChatCompletion({
      ...options,
      contents: rows,
    })) {
      /* drain local transport */
    }
  } finally {
    globalThis.fetch = original;
  }
  if (bodies.length !== 1)
    throw new Error(`Expected one body, received ${bodies.length}`);
  return bodies[0];
}

function saveBodies(
  size: number,
  explicit: boolean,
  actual: string,
  expected: string,
): void {
  const output = process.env.SEMANTIC_PURGE_BODY_OUTPUT;
  if (output === undefined) return;
  writeFileSync(join(output, `body-${size}-${explicit}-actual.json`), actual);
  writeFileSync(
    join(output, `body-${size}-${explicit}-expected.json`),
    expected,
  );
}

describe('semantic purge exact provider BODY BYTES', () => {
  for (const size of [512, 8192]) {
    for (const explicit of [false, true]) {
      it(`sends every ${size}-row ${explicit ? 'pre-image cache' : 'purge candidate'} byte against an independent eager wire oracle`, async () => {
        await withSuffixFixture(
          size,
          async (history) => {
            const coordinator = new SemanticMediaPurgeStreamCoordinator(
              history,
              { enabled: true, explicitCacheWriteRequired: false },
            );
            const transaction = await coordinator.begin({ mode: 'remove' });
            if (transaction === undefined)
              throw new Error('Missing purge transaction');
            try {
              const actual = await captureBody(
                transaction.requestRows(explicit),
              );
              const expected = JSON.stringify({
                model: 'gpt-5.2',
                input: independentInput(size, explicit),
                stream: true,
                instructions: 'test system prompt',
              });
              saveBodies(size, explicit, actual, expected);
              expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(
                true,
              );
            } finally {
              transaction.close();
            }
          },
          2048,
          bodyRow,
        );
      }, 120_000);
    }
  }
});
