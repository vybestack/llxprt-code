/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  withRequestRepresentationObserver,
  type RequestRepresentationKind,
} from '../utils/requestScopedBody.js';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import { GeminiProvider } from '../../../../plugins/google-gemini/src/gemini/GeminiProvider.js';

describe('SDK streamed history follow-ups', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function measure(
    gemini: boolean,
    retain?: RequestRepresentationKind,
    buffer = false,
  ): Promise<void> {
    const count = 6000;
    const seen = new WeakSet<object>();
    const refs = new Map<RequestRepresentationKind, Array<WeakRef<object>>>();
    const counts = new Map<RequestRepresentationKind, number>();
    const retained: unknown[] = [];
    let pulled = 0;
    let consumed = 0;
    let fullBodies = 0;
    function observe(kind: RequestRepresentationKind, value: unknown): void {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if (typeof value === 'string' && value.length > 1_000_000) fullBodies++;
      if (value instanceof Uint8Array && value.byteLength > 1_000_000)
        fullBodies++;
      if (kind === retain) retained.push(value);
      function visit(entry: unknown): void {
        if (entry === null || typeof entry !== 'object' || seen.has(entry))
          return;
        seen.add(entry);
        const group = refs.get(kind) ?? [];
        group.push(new WeakRef(entry));
        refs.set(kind, group);
        if (!(entry instanceof Uint8Array))
          for (const child of Object.values(entry)) visit(child);
      }
      visit(value);
    }
    function assertResidency(): void {
      for (const [kind, group] of refs) {
        const live = group.filter((ref) => ref.deref() !== undefined).length;
        if (live > (kind === 'envelope' ? 12 : 100))
          throw new Error(`CENSUS_RETAINED_${kind}`);
        group.splice(0);
      }
    }
    globalThis.fetch = Object.assign(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (!(init?.body instanceof ReadableStream))
          throw new Error('CENSUS_FULL_BODY');
        const reader = init.body.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            consumed = pulled;
            if (pulled > 0 && pulled % 1000 === 0) {
              await Bun.sleep(0);
              Bun.gc(true);
              assertResidency();
            }
          }
        } finally {
          reader.releaseLock();
        }
        return gemini
          ? Response.json({
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: 'ok' }] },
                  finishReason: 'STOP',
                },
              ],
            })
          : Response.json({
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
            });
      },
      { preconnect() {} },
    );
    function row(index: number): IContent {
      return {
        speaker: index % 2 === 0 ? 'human' : 'ai',
        blocks: [{ type: 'text', text: `${index}:` + '雪'.repeat(900) }],
      };
    }
    const requestRows = {
      count,
      readAt: row,
      async *openReader(): AsyncGenerator<IContent> {
        async function* source(): AsyncGenerator<IContent> {
          for (let index = 0; index < count; index++) {
            if (pulled > consumed + 1) throw new Error('BUFFERING_TRAP');
            pulled++;
            yield row(index);
          }
        }
        if (buffer) yield* await Array.fromAsync(source());
        else yield* source();
      },
      close() {},
    };
    const settings = new SettingsService();
    const options = createProviderCallOptions({
      providerName: gemini ? 'gemini' : 'openaivercel',
      settings,
      config: createRuntimeConfigStub(settings),
      contents: {
        [Symbol.asyncIterator](): AsyncGenerator<IContent> {
          throw new Error('Expected selection');
        },
      },
      ephemerals: { streaming: 'disabled' },
      resolved: {
        model: gemini ? 'gemini-3.7-flash' : 'gpt-4o',
        streaming: false,
      },
    });
    await withRequestRepresentationObserver(observe, async () => {
      const provider = gemini
        ? new GeminiProvider('test')
        : new OpenAIVercelProvider('test');
      for await (const chunk of provider.generateChatCompletion({
        ...options,
        requestRows,
      }))
        void chunk;
    });
    expect(pulled).toBe(count);
    const kinds: RequestRepresentationKind[] = [
      'neutral',
      'converted',
      'wire',
      'buffer',
    ];
    for (const kind of kinds)
      expect(counts.get(kind)).toBeGreaterThanOrEqual(count);
    expect(counts.get('envelope')).toBe(1);
    expect(fullBodies).toBe(0);
    expect(retained).toHaveLength(0);
  }

  for (const gemini of [false, true]) {
    it(`${gemini ? 'Gemini' : 'Vercel'} releases every observed conversion graph`, async () => {
      await expect(measure(gemini)).resolves.toBeUndefined();
    });
    for (const kind of ['converted', 'wire', 'buffer']) {
      it(`${gemini ? 'Gemini' : 'Vercel'} census rejects retained ${kind}`, async () => {
        if (kind !== 'converted' && kind !== 'wire' && kind !== 'buffer')
          throw new Error('Unexpected kind');
        await expect(measure(gemini, kind)).rejects.toThrow(
          `CENSUS_RETAINED_${kind}`,
        );
      });
    }
    it(`${gemini ? 'Gemini' : 'Vercel'} census rejects buffering before upload`, async () => {
      await expect(measure(gemini, undefined, true)).rejects.toThrow(
        'BUFFERING_TRAP',
      );
    });
  }
});
