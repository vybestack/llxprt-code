/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { listOpenAiCompatibleModels } from './endpoint-models.js';
import { ImageBackendError } from './imageBackendResponse.js';

function responseFetch(response: Response): typeof fetch {
  return async () => response;
}

describe('OpenAI-compatible models', () => {
  for (const suffix of ['', '/', '///']) {
    it(`joins the models endpoint with suffix '${suffix}' and forwards headers`, async () => {
      const fetchImpl: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        if (
          request.url !== 'http://localhost:1234/v1/models' ||
          request.method !== 'GET' ||
          request.headers.get('Authorization') !== 'Bearer test'
        ) {
          return new Response('incorrect request', { status: 400 });
        }
        return Response.json({
          data: [{ id: 'flux', extra: 1 }, { id: 'klein' }],
        });
      };
      expect(
        await listOpenAiCompatibleModels(
          `http://localhost:1234/v1${suffix}`,
          { Authorization: 'Bearer test' },
          { fetchImpl },
        ),
      ).toStrictEqual(['flux', 'klein']);
    });
  }
  for (const body of [{}, { data: [] }]) {
    it(`returns an empty list for ${JSON.stringify(body)}`, async () => {
      expect(
        await listOpenAiCompatibleModels('https://example.com/v1', undefined, {
          fetchImpl: responseFetch(Response.json(body)),
        }),
      ).toStrictEqual([]);
    });
  }
  it('throws a typed error on non-OK responses', async () => {
    await expect(
      listOpenAiCompatibleModels('https://example.com/v1', undefined, {
        fetchImpl: responseFetch(new Response('unavailable', { status: 503 })),
      }),
    ).rejects.toMatchObject({
      name: 'ImageBackendError',
      code: 'server_error',
      status: 503,
    });
  });
  it('throws a typed error on invalid JSON', async () => {
    await expect(
      listOpenAiCompatibleModels('https://example.com/v1', undefined, {
        fetchImpl: responseFetch(new Response('not json')),
      }),
    ).rejects.toBeInstanceOf(ImageBackendError);
  });
  it('rejects malformed model IDs', async () => {
    await expect(
      listOpenAiCompatibleModels('https://example.com/v1', undefined, {
        fetchImpl: responseFetch(Response.json({ data: [{ id: 3 }] })),
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('aborts a stalled request after five seconds with a typed error', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('missing timeout signal');
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    await expect(
      listOpenAiCompatibleModels('https://example.com/v1', undefined, {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ name: 'ImageBackendError', code: 'timeout' });
  }, 7000);
});
