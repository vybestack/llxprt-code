/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createAnthropicRawPostTestAdapter } from './rawPostTestAdapters.js';

function jsonBody(value: unknown): ReadableStream<Uint8Array> {
  const body = new Response(JSON.stringify(value)).body;
  if (body === null) throw new Error('Response did not create a body stream');
  return body;
}

describe('raw-post test adapters', () => {
  it('awaits async handlers before discriminating nested transport responses', async () => {
    const responseLike = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'retry-after': '7' }),
    };
    const adapter = createAnthropicRawPostTestAdapter(async () => ({
      withResponse: async () => ({
        data: { type: 'rate_limit_error' },
        response: responseLike,
      }),
    }));

    const transported = await adapter
      .post('/v1/messages', { body: jsonBody({ model: 'claude-test' }) })
      .withResponse();

    expect(transported.data).toStrictEqual({ type: 'rate_limit_error' });
    expect(transported.response?.status).toBe(429);
    expect(transported.response?.statusText).toBe('Too Many Requests');
    expect(transported.response?.headers.get('retry-after')).toBe('7');
  });
});
