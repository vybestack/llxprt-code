/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import {
  assertAnthropicRequestBodyWithinLimit,
  createAnthropicApiCall,
} from './AnthropicApiExecution.js';
import { RequestBodyByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { DEFAULT_HTTP_JSON_ENVELOPE_BYTES } from '../utils/boundedJsonBody.js';
import {
  ANTHROPIC_NATIVE_REQUEST_ENVELOPE_BYTES,
  resolveAnthropicRequestBodyLimitBytes,
} from './AnthropicEndpointUtils.js';

interface RecordedPost {
  readonly path: string;
  readonly contentLength: string | null;
}

class RecordingTransport {
  readonly posts: RecordedPost[] = [];

  readonly fetch: typeof fetch = (input, init) => {
    this.posts.push({
      path: new URL(input instanceof Request ? input.url : String(input))
        .pathname,
      contentLength: new Headers(init?.headers).get('content-length'),
    });
    return Promise.reject(new Error('transport stopped after recording'));
  };

  client(): Anthropic {
    return new Anthropic({
      apiKey: 'test-key',
      baseURL: 'https://api.anthropic.com',
      maxRetries: 0,
      fetch: this.fetch,
    });
  }
}

const REQUEST = {
  model: 'm',
  messages: [{ role: 'user', content: 'x'.repeat(90) }],
};
const REQUEST_BYTES = new TextEncoder().encode(JSON.stringify(REQUEST)).length;

async function settled(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('expected rejection');
}

describe('Anthropic request body guard (issue #3984)', () => {
  it('sends a body exactly at the limit with its exact content length', async () => {
    const transport = new RecordingTransport();

    await settled(
      createAnthropicApiCall(
        transport.client(),
        REQUEST,
        {},
        undefined,
        REQUEST_BYTES,
      )(),
    );

    expect(transport.posts).toStrictEqual([
      { path: '/v1/messages', contentLength: String(REQUEST_BYTES) },
    ]);
  });

  it('rejects a body one byte over the limit before any HTTP request', async () => {
    const transport = new RecordingTransport();

    const error = await settled(
      createAnthropicApiCall(
        transport.client(),
        REQUEST,
        {},
        undefined,
        REQUEST_BYTES - 1,
      )(),
    );

    expect([
      error instanceof RequestBodyByteOverflowError,
      transport.posts.length,
    ]).toStrictEqual([true, 0]);
  });

  it('reports exact and maximum byte counts in the typed error', async () => {
    const error = await settled(
      createAnthropicApiCall(
        new RecordingTransport().client(),
        REQUEST,
        {},
        undefined,
        REQUEST_BYTES - 1,
      )(),
    );

    expect(error).toMatchObject({
      totalBytes: REQUEST_BYTES,
      limitBytes: REQUEST_BYTES - 1,
    });
  });

  it('applies the same exact-body check without sending when projecting', async () => {
    await assertAnthropicRequestBodyWithinLimit(REQUEST, REQUEST_BYTES);

    const error = await settled(
      assertAnthropicRequestBodyWithinLimit(REQUEST, REQUEST_BYTES - 1),
    );

    expect(error).toMatchObject({
      name: 'RequestBodyByteOverflowError',
      totalBytes: REQUEST_BYTES,
      limitBytes: REQUEST_BYTES - 1,
    });
  });

  it('keeps the 32,000,000-byte cap on the native endpoint regardless of any media budget', () => {
    expect([
      resolveAnthropicRequestBodyLimitBytes(undefined),
      resolveAnthropicRequestBodyLimitBytes('https://api.anthropic.com'),
    ]).toStrictEqual([
      ANTHROPIC_NATIVE_REQUEST_ENVELOPE_BYTES,
      ANTHROPIC_NATIVE_REQUEST_ENVELOPE_BYTES,
    ]);
  });

  it('leaves compatible third-party endpoints on the generic allocation ceiling', () => {
    expect(resolveAnthropicRequestBodyLimitBytes('https://api.z.ai')).toBe(
      DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
    );
  });
});
