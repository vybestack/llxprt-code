/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  type ProviderRequestSelection,
  inMemoryRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';

describe('SDK streamed history follow-ups', () => {
  async function drain(contents: AsyncIterable<IContent>): Promise<void> {
    for await (const chunk of contents) void chunk;
  }

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const rows: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'lookup' }] },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_duplicate',
          name: 'lookup',
          parameters: { city: '雪' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_duplicate',
          toolName: 'lookup',
          result: 'found',
        },
      ],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'again' }] },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_second',
          name: 'lookup',
          parameters: { city: '東京' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_second',
          toolName: 'lookup',
          result: 'found again',
        },
      ],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'explain' }] },
  ];

  for (const model of ['kimi-k2', 'mistral-large']) {
    it(`${model} sends caller-owned and indexed rows with identical bytes`, async () => {
      const bodies: string[] = [];
      globalThis.fetch = Object.assign(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          if (!(init?.body instanceof ReadableStream))
            throw new Error('Expected streamed body');
          bodies.push(await new Response(init.body).text());
          return Response.json({
            id: 'test',
            object: 'chat.completion',
            created: 1,
            model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        },
        { preconnect() {} },
      );
      const settings = new SettingsService();
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        settings,
        config: createRuntimeConfigStub(settings),
        contents: {
          async *[Symbol.asyncIterator]() {
            yield* rows;
          },
        },
        resolved: { model, streaming: false },
      });
      const indexed = await journalSendFixture(rows);
      const caller: ProviderRequestSelection = {
        ...inMemoryRequestSelection(rows),
        callerOwned: true,
      };
      try {
        expect(indexed.selection.native).toBeDefined();
        const created = await operationFileCreates(
          () =>
            drain(
              new OpenAIVercelProvider('test').generateChatCompletion({
                ...options,
                requestRows: caller,
              }),
            ),
          true,
        );
        expect(created).toStrictEqual({ files: [], directories: [] });
        await drain(
          new OpenAIVercelProvider('test').generateChatCompletion({
            ...options,
            requestRows: indexed.selection,
          }),
        );
        for await (const chunk of new OpenAIVercelProvider(
          'test',
        ).generateChatCompletion(options))
          void chunk;
        const source = {
          openProviderRequest: async () => caller,
          [Symbol.asyncIterator](): AsyncGenerator<IContent> {
            throw new Error('Source must be opened, not collected');
          },
        };
        await drain(
          new OpenAIVercelProvider('test').generateChatCompletion({
            ...options,
            contents: source,
          }),
        );
        expect(bodies).toHaveLength(4);
        expect(bodies[3]).toBe(bodies[0]);
        expect(bodies[1]).toBe(bodies[0]);
        expect(bodies[2]).toBe(bodies[0]);
        expect(bodies[0]).toContain('tool_call_id');
        expect(bodies[0]).not.toContain('hist_duplicate');
        await expect(
          drain(
            new OpenAIVercelProvider('test').generateChatCompletion({
              ...options,
              requestRows: inMemoryRequestSelection(rows),
            }),
          ),
        ).rejects.toThrow('indexed or caller-owned');
      } finally {
        await indexed.close();
      }
    });
  }
});
