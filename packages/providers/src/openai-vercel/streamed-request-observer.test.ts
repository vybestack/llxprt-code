/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createStreamedVercelFetch } from './streamed-request.js';
import type { RequestRepresentationKind } from '../utils/requestScopedBody.js';

describe('request-local representation observation', () => {
  it('keeps concurrent streamed bodies and their observers separate', async () => {
    async function send(text: string): Promise<{
      body: string;
      observed: string[];
      kinds: Set<RequestRepresentationKind>;
    }> {
      const observed: string[] = [];
      const kinds = new Set<RequestRepresentationKind>();
      let body = '';
      const innerFetch = Object.assign(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          body = await new Response(init?.body).text();
          return Response.json({ ok: true });
        },
        { preconnect() {} },
      );
      const transport = createStreamedVercelFetch(
        innerFetch,
        async function* () {
          await Promise.resolve();
          yield { role: 'user', content: text };
        },
        {
          requestRepresentationObserver(
            kind: RequestRepresentationKind,
            value: unknown,
          ): void {
            kinds.add(kind);
            if (kind === 'wire') observed.push(JSON.stringify(value));
          },
        },
      );
      await transport('https://provider.test/chat/completions', {
        body: JSON.stringify({ messages: [{ role: 'user', content: '' }] }),
      });
      return { body, observed, kinds };
    }
    const [first, second] = await Promise.all([
      send('first request'),
      send('second request'),
    ]);
    expect(JSON.parse(first.body)).toStrictEqual({
      messages: [{ role: 'user', content: 'first request' }],
    });
    expect(JSON.parse(second.body)).toStrictEqual({
      messages: [{ role: 'user', content: 'second request' }],
    });
    expect(first.observed.map((wire) => JSON.parse(wire))).toStrictEqual(
      JSON.parse(first.body).messages,
    );
    expect(second.observed.map((wire) => JSON.parse(wire))).toStrictEqual(
      JSON.parse(second.body).messages,
    );
    expect([...first.kinds].sort()).toStrictEqual([
      'buffer',
      'envelope',
      'serialized',
      'wire',
    ]);
    expect([...second.kinds].sort()).toStrictEqual([
      'buffer',
      'envelope',
      'serialized',
      'wire',
    ]);
  });
});
