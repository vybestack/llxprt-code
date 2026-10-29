/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';

const originalFetch = globalThis.fetch;
describe('Vercel row-streamed request residency', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams 65 rows without retaining a second history representation', async () => {
    const count = 65;
    let pulled = 0;
    let consumed = 0;
    let bytes = 0;
    const refs: Array<WeakRef<IContent>> = [];
    let peakLiveRows = 0;
    const digest = createHash('sha256');
    const settings = new SettingsService();
    const config = createRuntimeConfigStub(settings);
    const row = (index: number): IContent => ({
      speaker: index % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `${index}:` + 'x'.repeat(2600) }],
    });
    const census = (): number =>
      refs.reduce((sum, ref) => sum + Number(ref.deref() !== undefined), 0);
    globalThis.fetch = Object.assign(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        expect(pulled).toBe(0);
        expect(typeof init?.body).not.toBe('string');
        if (!(init?.body instanceof ReadableStream))
          throw new Error('Expected streamed body');
        const reader = init.body.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            digest.update(next.value);
            bytes += next.value.byteLength;
            consumed = pulled;
            if (refs.length >= 8) {
              await Bun.sleep(0);
              Bun.gc(true);
              peakLiveRows = Math.max(peakLiveRows, census());
              refs.splice(0);
            }
          }
        } finally {
          reader.releaseLock();
        }
        return Response.json({
          id: 'test',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o',
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
      { preconnect: originalFetch.preconnect },
    );
    const options = createProviderCallOptions({
      providerName: 'openaivercel',
      config,
      settings,
      contents: {
        [Symbol.asyncIterator](): AsyncGenerator<IContent> {
          throw new Error('Unexpected contents read');
        },
      },
      resolved: { model: 'gpt-4o', streaming: false },
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
    for await (const _chunk of new OpenAIVercelProvider(
      'test',
    ).generateChatCompletion({
      ...options,
      requestRows,
      contentCount: count,
    })) {
      /* consume */
    }
    expect(pulled).toBe(count);
    expect(peakLiveRows).toBeLessThan(20);
    expect(bytes).toBeGreaterThan(count * 2600);
    expect(digest.digest('hex')).toHaveLength(64);

    const retained = Array.from({ length: 100 }, (_, index) => row(index));
    const controlRefs = retained.map((value) => new WeakRef(value));
    Bun.gc(true);
    expect(() =>
      expect(
        controlRefs.filter((ref) => ref.deref() !== undefined).length,
      ).toBeLessThan(20),
    ).toThrow('toBeLessThan');
    expect(retained.length).toBe(100);
  });
});
