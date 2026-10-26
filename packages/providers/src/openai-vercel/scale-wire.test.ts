/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import { GeminiProvider } from '../../../../plugins/google-gemini/src/gemini/GeminiProvider.js';
import frozen from './scale-wire-digests.json' with { type: 'json' };

describe('SDK streamed history follow-ups', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function* history(image: MediaReferenceBlock): Generator<IContent> {
    for (let turn = 0; turn < 1500; turn++) {
      let id = `ID${String(turn).padStart(7, '0')}`;
      if (turn % 3 === 0) id = `call_${turn}`;
      if (turn % 3 === 1) id = `hist_${turn}`;
      yield {
        speaker: 'human',
        blocks: [
          { type: 'text', text: `${turn}: 雪\n` + 'x'.repeat(2000) },
          ...(turn % 100 === 0 ? [image] : []),
        ],
      };
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id,
            name: 'lookup',
            parameters: { city: '東京', turn },
          },
        ],
      };
      yield {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: id,
            toolName: 'lookup',
            result: { text: 'y'.repeat(2000), turn },
          },
        ],
      };
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: `answer ${turn}` }],
      };
    }
    yield { speaker: 'human', blocks: [{ type: 'text', text: 'summarize' }] };
  }

  async function consumeChunks(
    init: RequestInit | undefined,
    consume: (bytes: Uint8Array) => void,
  ): Promise<void> {
    const reader = new Response(init?.body).body?.getReader();
    if (reader === undefined) throw new Error('Missing request');
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        consume(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  for (const model of [
    'gpt-4o',
    'kimi-k2',
    'mistral-large',
    'gemini-3.7-flash',
  ]) {
    it(`${model} matches frozen pre-streaming SDK bytes for 6001 disk-backed rows`, async () => {
      const parent = join(import.meta.dir, '../../../../tmp/r7b-sdk');
      mkdirSync(parent, { recursive: true });
      const root = mkdtempSync(join(parent, 'scale-'));
      const store = new LocalMediaStore({
        rootDirectory: join(root, 'media'),
        quotaBytes: 1024,
      });
      const image = await store.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const fixture = await journalSendFixture(history(image), [], {
        directory: root,
        seedBatchRows: 128,
        mediaStore: store,
      });
      const digest = createHash('sha256');
      let bytes = 0;
      let sends = 0;
      globalThis.fetch = Object.assign(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          sends++;
          await consumeChunks(init, (chunk) => {
            digest.update(chunk);
            bytes += chunk.byteLength;
          });
          return model.startsWith('gemini')
            ? Response.json({
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
              })
            : Response.json({
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
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2,
                },
              });
        },
        { preconnect() {} },
      );
      const settings = new SettingsService();
      const gemini = model.startsWith('gemini');
      const provider = bindProviderMedia(
        gemini ? new GeminiProvider('test') : new OpenAIVercelProvider('test'),
        new RequestMediaResolver(store),
        1024,
      );
      const options = createProviderCallOptions({
        providerName: gemini ? 'gemini' : 'openaivercel',
        config: createRuntimeConfigStub(settings),
        settings,
        contents: {
          [Symbol.asyncIterator](): AsyncGenerator<IContent> {
            throw new Error('Expected journal reader');
          },
        },
        resolved: { model, streaming: false },
        ephemerals: { streaming: 'disabled' },
      });
      try {
        for await (const chunk of provider.generateChatCompletion({
          ...options,
          requestRows: fixture.selection,
        }))
          void chunk;
        expect(sends).toBe(1);
        expect(fixture.selection.count).toBe(6001);
        const actual = { bytes, sha256: digest.digest('hex') };
        const expected = frozen.routes.find((route) => route.model === model);
        if (expected === undefined) throw new Error('Missing frozen route');
        expect(actual).toStrictEqual(expected.body);
      } finally {
        await fixture.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
