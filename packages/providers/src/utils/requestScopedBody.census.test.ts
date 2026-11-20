/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  RequestBodyCensus,
  acquireRequestScopedBody,
  activeRequestBodyCount,
  withRequestScopedBody,
} from './requestScopedBody.js';
import { OpenAIVercelProvider } from '../openai-vercel/OpenAIVercelProvider.js';

describe('provider runtime request body census', () => {
  it('shares acquisition and probes within an owner and isolates other runtimes', async () => {
    const first = new RequestBodyCensus();
    const second = new RequestBodyCensus();
    const provider = new OpenAIVercelProvider('test-key', undefined, {
      requestBodyCensus: first,
    });
    const other = new OpenAIVercelProvider('test-key', undefined, {
      requestBodyCensus: second,
    });
    const held = acquireRequestScopedBody(
      'openai-vercel',
      { rows: [1] },
      first,
    );
    try {
      expect(activeRequestBodyCount(provider.requestBodyCensus)).toBe(1);
      expect(activeRequestBodyCount(other.requestBodyCensus)).toBe(0);
      await withRequestScopedBody(
        'openai-vercel',
        () => ({ rows: [2] }),
        async (body) => {
          const otherBody = acquireRequestScopedBody(
            'openai-vercel',
            { rows: [3] },
            second,
          );
          try {
            expect(body.value.rows).toStrictEqual([2]);
            expect(activeRequestBodyCount(provider.requestBodyCensus)).toBe(2);
            expect(activeRequestBodyCount(other.requestBodyCensus)).toBe(1);
          } finally {
            await otherBody.release();
          }
        },
        first,
      );
      expect(activeRequestBodyCount(first)).toBe(1);
      await held.release();
      await held.release();
      expect(activeRequestBodyCount(first)).toBe(0);
    } finally {
      await held.release();
    }
  });
});
