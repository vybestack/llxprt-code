/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  CodexImageBackend,
  buildCodexImageGenerateEndpoint,
  CODEX_IMAGE_MODEL,
} from './codexImageBackend.js';
import {
  ImageGenerationError,
  ImageValidationError,
  type ImageGenerateRequest,
} from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';

/**
 * Runs `operation` expecting rejection and returns the rejection reason.
 * Fails closed via expect.fail if the operation fulfills, so tests cannot
 * pass silently when the promise resolves with an Error-shaped value.
 */
const NOT_REJECTED = Symbol('not-rejected');

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  const outcome: unknown = await operation.then(
    () => NOT_REJECTED,
    (error: unknown) => error,
  );
  if (outcome === NOT_REJECTED) {
    expect.fail('expected the operation to reject');
  }
  return outcome;
}

/**
 * Captured fetch request for assertion.
 */
interface CapturedRequest {
  url: string;
  init: RequestInit;
}

/**
 * Build a stub fetch that records the request and returns the given response.
 * The fetch implementation is injected infrastructure — the adapter itself is
 * never mocked.
 */
function makeStubFetch(response: { status: number; body: unknown }): {
  fetchImpl: typeof fetch;
  captured: () => CapturedRequest | undefined;
} {
  let captured: CapturedRequest | undefined;
  const fetchImpl: typeof fetch = async (
    input: URL | RequestInfo,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    captured = { url, init: init ?? {} };
    // Honor the abort signal realistically: a native fetch rejects with an
    // AbortError when the signal is already aborted. The stub mirrors that so
    // the adapter's abort-propagation behavior is exercised against real
    // infrastructure semantics, not mocked adapter logic.
    if (init?.signal?.aborted === true) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, captured: () => captured };
}

function makeBackend(overrides?: {
  fetchImpl?: typeof fetch;
  getBaseUrl?: () => string | undefined;
  credential?: { accessToken: string; accountId: string };
}): CodexImageBackend {
  return new CodexImageBackend({
    getCredential: async () =>
      overrides?.credential ?? {
        accessToken: 'token-abc',
        accountId: 'account-xyz',
      },
    getBaseUrl: overrides?.getBaseUrl ?? (() => undefined),
    fetchImpl: overrides?.fetchImpl ?? fetch,
  });
}

describe('buildCodexImageGenerateEndpoint', () => {
  it('returns the canonical chatgpt.com endpoint when no base url is given', () => {
    expect(buildCodexImageGenerateEndpoint(undefined)).toBe(
      'https://chatgpt.com/backend-api/codex/images/generations',
    );
  });

  it('derives the endpoint from a base url containing /backend-api/codex', () => {
    expect(
      buildCodexImageGenerateEndpoint('https://chatgpt.com/backend-api/codex'),
    ).toBe('https://chatgpt.com/backend-api/codex/images/generations');
  });

  it('falls back to the canonical endpoint when the base url does not match codex', () => {
    expect(buildCodexImageGenerateEndpoint('https://example.com/api')).toBe(
      'https://chatgpt.com/backend-api/codex/images/generations',
    );
  });
});

describe('CodexImageBackend', () => {
  it('uses name "codex" and the gpt-image-2 model constant', () => {
    const backend = makeBackend();
    expect(backend.name).toBe('codex');
    expect(CODEX_IMAGE_MODEL).toBe('gpt-image-2');
  });

  describe('A1 — request shape', () => {
    it('posts to the generate endpoint with model gpt-image-2 and auto defaults, n:1', async () => {
      const { fetchImpl, captured } = makeStubFetch({
        status: 200,
        body: { data: [{ b64_json: 'aGVsbG8=' }] },
      });
      const backend = makeBackend({ fetchImpl });

      await backend.generate(
        { prompt: 'a serene mountain lake at dawn' },
        new AbortController().signal,
      );

      const req = captured();
      expect(req).toBeDefined();
      expect(req?.init.method).toBe('POST');
      expect(req?.url).toBe(
        'https://chatgpt.com/backend-api/codex/images/generations',
      );

      const body = JSON.parse(req?.init.body as string) as Record<
        string,
        unknown
      >;
      expect(body['model']).toBe('gpt-image-2');
      expect(body['prompt']).toBe('a serene mountain lake at dawn');
      expect(body['background']).toBe('auto');
      expect(body['quality']).toBe('auto');
      expect(body['size']).toBe('auto');
      expect(body['n']).toBe(1);
      // The generation contract must NOT include edit-only keys.
      expect(body['images']).toBeUndefined();
      expect(body['image']).toBeUndefined();
      // The body must contain ONLY the documented generation keys — no
      // extra/undocumented fields that the provider might reject.
      expect(Object.keys(body).sort()).toStrictEqual(
        ['background', 'model', 'n', 'prompt', 'quality', 'size'].sort(),
      );
    });
  });

  describe('A2 — headers', () => {
    it('sends the full header set without session_id when sessionId is absent', async () => {
      const { fetchImpl, captured } = makeStubFetch({
        status: 200,
        body: { data: [{ b64_json: 'aGVsbG8=' }] },
      });
      const backend = makeBackend({ fetchImpl });

      await backend.generate({ prompt: 'hello' }, new AbortController().signal);

      const headers = captured()?.init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer token-abc');
      expect(headers['ChatGPT-Account-ID']).toBe('account-xyz');
      expect(headers['originator']).toBe('codex_cli_rs');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers).not.toHaveProperty('session_id');
    });

    it('includes session_id when sessionId is provided', async () => {
      const { fetchImpl, captured } = makeStubFetch({
        status: 200,
        body: { data: [{ b64_json: 'aGVsbG8=' }] },
      });
      const backend = makeBackend({ fetchImpl });

      await backend.generate(
        { prompt: 'hello', sessionId: 'sess-123' },
        new AbortController().signal,
      );

      const headers = captured()?.init.headers as Record<string, string>;
      expect(headers['session_id']).toBe('sess-123');
    });
  });

  describe('A3 — response normalization', () => {
    it('normalizes data[0].b64_json into a base64/png ImageResult with the prompt as caption', async () => {
      const { fetchImpl } = makeStubFetch({
        status: 200,
        body: { data: [{ b64_json: 'aGVsbG8=' }] },
      });
      const backend = makeBackend({ fetchImpl });

      const result = await backend.generate(
        { prompt: 'a red panda' },
        new AbortController().signal,
      );

      expect(result.mimeType).toBe('image/png');
      expect(result.encoding).toBe('base64');
      expect(result.data).toBe('aGVsbG8=');
      expect(result.caption).toBe('a red panda');
    });
  });

  describe('A4 — validation before fetch', () => {
    it('throws ImageValidationError before any fetch for an empty prompt', async () => {
      let fetchCalled = false;
      const fetchImpl: typeof fetch = async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      };
      const backend = makeBackend({ fetchImpl });

      expect(
        await captureRejection(
          backend.generate({ prompt: '   ' }, new AbortController().signal),
        ),
      ).toBeInstanceOf(ImageValidationError);
      expect(fetchCalled).toBe(false);
    });
  });

  describe('A5 — error handling', () => {
    it('throws ImageGenerationError carrying status/endpoint/bodySnippet on a 4xx', async () => {
      const { fetchImpl } = makeStubFetch({
        status: 403,
        body: { error: 'forbidden' },
      });
      const backend = makeBackend({ fetchImpl });

      expect(
        await captureRejection(
          backend.generate({ prompt: 'hello' }, new AbortController().signal),
        ),
      ).toMatchObject({
        name: 'ImageGenerationError',
        status: 403,
        endpoint: expect.stringContaining('/images/generations'),
        bodySnippet: expect.any(String),
      });
    });

    it('throws ImageGenerationError carrying status/endpoint/bodySnippet on a 5xx', async () => {
      const { fetchImpl } = makeStubFetch({
        status: 500,
        body: { error: 'internal' },
      });
      const backend = makeBackend({ fetchImpl });

      expect(
        await captureRejection(
          backend.generate({ prompt: 'hello' }, new AbortController().signal),
        ),
      ).toMatchObject({
        name: 'ImageGenerationError',
        status: 500,
        endpoint: expect.stringContaining('/images/generations'),
        bodySnippet: expect.any(String),
      });
    });

    it('throws ImageGenerationError when data is missing or empty', async () => {
      const { fetchImpl } = makeStubFetch({
        status: 200,
        body: { data: [] },
      });
      const backend = makeBackend({ fetchImpl });

      expect(
        await captureRejection(
          backend.generate({ prompt: 'hello' }, new AbortController().signal),
        ),
      ).toBeInstanceOf(ImageGenerationError);
    });

    it('throws ImageGenerationError when data[0] lacks b64_json', async () => {
      const { fetchImpl } = makeStubFetch({
        status: 200,
        body: { data: [{ url: 'https://example.com/img.png' }] },
      });
      const backend = makeBackend({ fetchImpl });

      expect(
        await captureRejection(
          backend.generate({ prompt: 'hello' }, new AbortController().signal),
        ),
      ).toBeInstanceOf(ImageGenerationError);
    });
  });

  describe('model immutability', () => {
    it('forces model gpt-image-2 even when request.model is a different/malicious value', async () => {
      const { fetchImpl, captured } = makeStubFetch({
        status: 200,
        body: { data: [{ b64_json: 'aGVsbG8=' }] },
      });
      const backend = makeBackend({ fetchImpl });

      await backend.generate(
        {
          prompt: 'a serene mountain lake',
          model: 'gpt-evil-override' as string,
        } as ImageGenerateRequest,
        new AbortController().signal,
      );

      const body = JSON.parse(captured()?.init.body as string) as Record<
        string,
        unknown
      >;
      expect(body['model']).toBe('gpt-image-2');
      expect(body['model']).not.toBe('gpt-evil-override');
    });
  });

  describe('A7 — abort propagation', () => {
    it('surfaces an abort error when the signal is already aborted', async () => {
      const { fetchImpl } = makeStubFetch({
        status: 200,
        body: { data: [{ b64_json: 'aGVsbG8=' }] },
      });
      const backend = makeBackend({ fetchImpl });
      const controller = new AbortController();
      controller.abort();

      expect(
        await captureRejection(
          backend.generate(
            { prompt: 'hello' } satisfies ImageGenerateRequest,
            controller.signal,
          ),
        ),
      ).toMatchObject({ message: expect.stringContaining('aborted') });
    });

    it('forwards the abort signal to the underlying fetch call', async () => {
      let capturedSignal: AbortSignal | undefined;
      const fetchImpl: typeof fetch = ((
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        capturedSignal = init?.signal;
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), {
            status: 200,
          }),
        );
      }) as typeof fetch;

      const backend = makeBackend({ fetchImpl });
      const controller = new AbortController();
      await backend.generate({ prompt: 'hello' }, controller.signal);

      expect(capturedSignal).toBe(controller.signal);
    });
  });

  describe('n validation', () => {
    it('rejects n > 1 before any network call', async () => {
      let fetchCalled = false;
      const fetchImpl: typeof fetch = (() => {
        fetchCalled = true;
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as typeof fetch;
      const backend = makeBackend({ fetchImpl });

      expect(
        await captureRejection(
          backend.generate(
            { prompt: 'hello', n: 2 },
            new AbortController().signal,
          ),
        ),
      ).toMatchObject({ message: expect.stringContaining('n=1') });

      expect(fetchCalled).toBe(false);
    });

    it('rejects n < 1 before any network call', async () => {
      let fetchCalled = false;
      const fetchImpl: typeof fetch = (() => {
        fetchCalled = true;
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as typeof fetch;
      const backend = makeBackend({ fetchImpl });

      expect(
        await captureRejection(
          backend.generate(
            { prompt: 'hello', n: 0 },
            new AbortController().signal,
          ),
        ),
      ).toMatchObject({ message: expect.stringContaining('n=1') });

      expect(fetchCalled).toBe(false);
    });
  });

  describe('ImageGenerationError type guard', () => {
    it('thrown errors are instanceof ImageGenerationError', async () => {
      const { fetchImpl } = makeStubFetch({
        status: 500,
        body: { error: 'boom' },
      });
      const backend = makeBackend({ fetchImpl });

      expect(
        await captureRejection(
          backend.generate({ prompt: 'hello' }, new AbortController().signal),
        ),
      ).toBeInstanceOf(ImageGenerationError);
    });
  });

  describe('body-read failure preservation', () => {
    it('preserves the underlying cause when response.text() rejects on a 2xx response', async () => {
      // When the response body read fails (stream/abort/encoding), the
      // surfaced error must preserve the original error as `cause` and must
      // NOT be misreported as a "non-JSON response" parse error.
      const bodyReadError = new Error('stream disturbed');
      const fetchImpl: typeof fetch = (() =>
        Promise.resolve(
          new Response(
            // A ReadableStream whose read() rejects, so response.text() fails.
            new ReadableStream({
              start(controller) {
                controller.error(bodyReadError);
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )) as typeof fetch;
      const backend = makeBackend({ fetchImpl });

      const error = await backend
        .generate({ prompt: 'hello' }, new AbortController().signal)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ImageGenerationError);
      const genError = error as ImageGenerationError;
      // The cause must be the original body-read error.
      expect(genError.cause).toBe(bodyReadError);
      // Must NOT be a "non-JSON response" message (that would indicate the
      // body read failure was swallowed and misreported).
      expect(genError.message).not.toMatch(/non-JSON/i);
      expect(genError.message).toMatch(/could not be read/i);
    });
  });
});
