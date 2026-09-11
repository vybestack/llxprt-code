/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ImageBackend,
  ImageGenerateRequest,
} from '@vybestack/llxprt-code-providers/imageBackend.js';
import { CodexImageBackend } from './codexImageBackend.js';
import { OpenAIImagesBackend } from './openaiImagesBackend.js';
import { createImageApiKeyResolver } from '../image-auth-resolution.js';
import {
  createCodexImageBackendResolver,
  resolveImageProfileBackendConfig,
} from './codexImageBackendResolver.js';

import {
  ImageBackendError,
  imageResponseError,
} from './imageBackendResponse.js';
import {
  ImageBackendBaseUrlError,
  validateCodexImageProfileBaseUrl,
} from './imageEndpoint.js';
import type { ImageProfile } from '@vybestack/llxprt-code-settings';

describe('external image responses', () => {
  it.each(['api-key', 'keyfile'] as const)(
    'rejects multi-line %s credentials without leaking secrets',
    async (type) => {
      const directory = await mkdtemp(
        join(tmpdir(), 'llxprt-image-credential-'),
      );
      try {
        const credential = 'FAKE-MULTILINE-SECRET\r\nsecond-line\r\n';
        const path = join(directory, 'key');
        await writeFile(path, credential);
        const auth: ImageProfile['auth'] =
          type === 'api-key' ? { type, apiKey: credential } : { type, path };
        const transport = http();
        const resolveKey = createImageApiKeyResolver();
        const backend = new OpenAIImagesBackend({
          config: { ...config('https://example.com/v1'), auth },
          getApiKey: () => resolveKey(auth),
          fetchImpl: transport.fetchImpl,
        });
        const error: unknown = await backend
          .generate({ prompt: 'lake' }, signal())
          .catch((error: unknown) => error);
        expect(error).toBeInstanceOf(ImageBackendError);
        if (!(error instanceof Error))
          throw new Error('Expected credential error');
        expect(error.message).toContain('contains invalid characters');
        expect(error.message).not.toContain('FAKE-MULTILINE-SECRET');
        expect(transport.requests).toHaveLength(0);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('redacts userinfo and query secrets from rejected Codex destinations', () => {
    let error: unknown;
    try {
      validateCodexImageProfileBaseUrl(
        'https://user:FAKE-PASSWORD@chatgpt.com/backend-api/codex?token=FAKE-QUERY',
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ImageBackendBaseUrlError);
    if (!(error instanceof Error)) throw new Error('Expected URL error');
    expect(error.message).not.toContain('FAKE-PASSWORD');
    expect(error.message).not.toContain('FAKE-QUERY');
    expect(error.message).toContain('https://chatgpt.com/backend-api/codex');
  });

  it.each([
    { model: 'gpt-image-1', responseFields: {} },
    { model: 'gpt-image-2', responseFields: {} },
    { model: 'dall-e-3', responseFields: { response_format: 'b64_json' } },
  ])(
    'uses the remote response vocabulary for $model',
    async ({ model, responseFields }) => {
      const transport = http();
      const backend = new OpenAIImagesBackend({
        config: { ...config('https://example.com/v1'), model },
        getApiKey: async () => 'secret',
        fetchImpl: transport.fetchImpl,
      });
      await backend.generate({ prompt: 'lake' }, signal());
      const body = await transport.requests[0].json();
      expect(body).toStrictEqual({
        model,
        prompt: 'lake',
        n: 1,
        ...responseFields,
      });
    },
  );

  it.each([
    'Incorrect API key provided: FAKE-REVIEW-SECRET',
    'Incorrect API key provided: "FAKE-REVIEW-SECRET"',
    "Incorrect API key provided: 'FAKE-REVIEW-SECRET'",
  ])('redacts arbitrary echoed API keys in remote errors: %s', (message) => {
    const error = imageResponseError(
      { error: { message: `${message}; check your account` } },
      401,
    );
    expect(error.message).not.toContain('FAKE-REVIEW-SECRET');
    expect(error.message).toContain('check your account');
  });

  it.each([true, false])(
    'preserves sparse OpenAI response metadata presence=%s',
    async (reported) => {
      const metadata = reported
        ? { quality: 'high', size: '512x512', usage: { output_tokens: 7 } }
        : {};
      const transport = http({
        data: [{ b64_json: png.toString('base64') }],
        ...metadata,
      });
      const backend = new OpenAIImagesBackend({
        config: config('https://example.com/v1'),
        getApiKey: async () => 'secret',
        fetchImpl: transport.fetchImpl,
      });
      const result = await backend.generate({ prompt: 'lake' }, signal());
      for (const field of ['quality', 'size', 'usage'] as const) {
        expect(Object.hasOwn(result, field)).toBe(reported);
        expect(result[field]).toStrictEqual(metadata[field]);
      }
    },
  );
});

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const signal = (): AbortSignal => new AbortController().signal;
function config(
  baseUrl = 'http://localhost:8321/v1',
  operations?: ImageProfile['operations'],
) {
  return resolveImageProfileBackendConfig({
    version: 1,
    type: 'image',
    backend: 'openai-images',
    model: 'FLUX.2-klein',
    baseUrl,
    ...(operations === undefined ? {} : { operations }),
    auth: baseUrl.includes('example')
      ? { type: 'api-key', apiKey: 'secret' }
      : { type: 'none' },
  });
}
function http(
  body: unknown = { data: [{ b64_json: png.toString('base64'), url: null }] },
  status = 200,
) {
  const requests: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(body, { status });
  };
  return { fetchImpl, requests };
}

describe('MLX dialect', () => {
  it.each(['generate', 'edit'] as const)(
    'rejects unsupported %s before request construction',
    async (operation) => {
      const transport = http();
      const backend = new OpenAIImagesBackend({
        config: config(undefined, [
          operation === 'generate' ? 'edit' : 'generate',
        ]),
        fetchImpl: transport.fetchImpl,
      });
      const request = { prompt: 'lake', inputPaths: ['/nonexistent.png'] };
      await expect(backend[operation](request, signal())).rejects.toMatchObject(
        { name: 'ImageBackendError', code: 'unsupported_operation' },
      );
      expect(transport.requests).toHaveLength(0);
    },
  );
  it.each(['response', 'fetch'] as const)(
    'redacts echoed credentials from %s errors',
    async (source) => {
      const message =
        'Incorrect API key provided: FAKE-REVIEW-SECRET; Bearer other-token; sk-proj-probe; https://cdn.example/image?signature=hidden&token=private';
      const backend = new OpenAIImagesBackend({
        config: config('https://example.com/v1'),
        getApiKey: async () => 'FAKE-REVIEW-SECRET',
        fetchImpl: async () => {
          if (source === 'fetch') throw new Error(message);
          return Response.json({ error: { message } }, { status: 401 });
        },
      });
      const error: unknown = await backend
        .generate({ prompt: 'lake' }, signal())
        .catch((error: unknown) => error);
      expect(error).toMatchObject({ name: 'ImageBackendError' });
      expect(String(error)).toContain('Incorrect API key provided:');
      for (const secret of [
        'FAKE-REVIEW-SECRET',
        'other-token',
        'sk-proj-probe',
        'signature=hidden',
        'token=private',
      ])
        expect(String(error)).not.toContain(secret);
    },
  );
  it.each([undefined, '256x256', '512x512', '1024x1024'] as const)(
    'sends only supported generation fields with size %s',
    async (size) => {
      const transport = http();
      const backend: ImageBackend = new OpenAIImagesBackend({
        config: {
          ...config(),
          overrides: {
            quality: 'max',
            background: 'transparent',
            ...(size === undefined ? {} : { size }),
          },
        },
        fetchImpl: transport.fetchImpl,
      });
      await backend.generate({ prompt: 'lake' }, signal());
      expect(await transport.requests[0].json()).toStrictEqual({
        model: 'FLUX.2-klein',
        prompt: 'lake',
        n: 1,
        response_format: 'b64_json',
        ...(size === undefined ? {} : { size }),
      });
      expect(transport.requests[0].headers.has('authorization')).toBe(false);
    },
  );
  it.each(['auto', '1024x1536', '1536x1024'] as const)(
    'rejects unsupported size %s before HTTP',
    async (size) => {
      const transport = http();
      const backend = new OpenAIImagesBackend({
        config: config(),
        fetchImpl: transport.fetchImpl,
      });
      await expect(
        backend.generate({ prompt: 'lake', size }, signal()),
      ).rejects.toMatchObject({ name: 'ImageValidationError' });
      expect(transport.requests).toHaveLength(0);
    },
  );
  it.each([0, 2, -1])(
    'rejects n=%s instead of silently dropping requested images',
    async (n) => {
      const transport = http();
      const backend = new OpenAIImagesBackend({
        config: config(),
        fetchImpl: transport.fetchImpl,
      });
      await expect(
        backend.generate({ prompt: 'lake', n }, signal()),
      ).rejects.toThrow('n=1');
      expect(transport.requests).toHaveLength(0);
    },
  );
  it('sends a single multipart image without Codex extras', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'issue3627-edit-'));
    try {
      const inputPath = join(directory, 'input.png');
      await writeFile(inputPath, png);
      const transport = http();
      const backend: ImageBackend = new OpenAIImagesBackend({
        config: {
          ...config(),
          overrides: { size: 'auto', quality: 'max', background: 'auto' },
        },
        fetchImpl: transport.fetchImpl,
      });
      await backend.edit(
        { prompt: 'change lake', inputPaths: [inputPath] },
        signal(),
      );
      const form = await transport.requests[0].formData();
      expect([...form.keys()].sort()).toStrictEqual([
        'image',
        'model',
        'prompt',
      ]);
      const image = form.get('image');
      expect(image).toBeInstanceOf(Blob);
      if (!(image instanceof Blob)) throw new Error('Expected uploaded image');
      expect(Buffer.from(await image.arrayBuffer())).toStrictEqual(png);
      expect(transport.requests[0].url).toEndWith('/images/edits');
      await expect(
        backend.edit(
          { prompt: 'edit', inputPaths: [inputPath, inputPath] },
          signal(),
        ),
      ).rejects.toThrow('at most 1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each([
    [
      422,
      {
        detail: [
          {
            type: 'literal_error',
            loc: ['body', 'size'],
            msg: 'Input should be 256x256',
            input: 'auto',
          },
        ],
      },
      'validation',
    ],
    [
      404,
      {
        detail: {
          error: {
            message: "Model 'x' not found",
            type: 'model_not_found',
            code: 404,
          },
        },
      },
      'model_not_found',
    ],
    [
      500,
      {
        detail: {
          error: {
            message: 'Inference failed',
            type: 'server_error',
            code: '500',
          },
        },
      },
      'server_error',
    ],
    [
      500,
      { error: { message: '', type: 'internal_error', code: '500' } },
      'timeout',
    ],
  ] as const)('maps HTTP %s error envelopes', async (status, body, code) => {
    const transport = http(body, status);
    const backend = new OpenAIImagesBackend({
      config: config(),
      fetchImpl: transport.fetchImpl,
    });
    await expect(
      backend.generate({ prompt: 'lake' }, signal()),
    ).rejects.toMatchObject({
      name: 'ImageBackendError',
      code,
      status,
      message: expect.stringMatching(/\S/),
    });
  });
  it.each(['localhost', '127.0.0.2', '[::1]'])(
    'resolves local profile %s without conversational auth',
    async (host) => {
      const transport = http();
      const backend = createCodexImageBackendResolver({
        oauthManager: undefined,
        getActiveProvider: () => undefined,
        getActiveImageProfile: () => ({
          version: 1,
          type: 'image',
          backend: 'openai-images',
          model: 'klein',
          baseUrl: `http://${host}:8321/v1`,
          auth: { type: 'none' },
        }),
        fetchImpl: transport.fetchImpl,
      })();
      expect(backend).not.toBeNull();
      await backend?.generate({ prompt: 'lake' }, signal());
      expect(await transport.requests[0].json()).toStrictEqual({
        model: 'klein',
        prompt: 'lake',
        n: 1,
        response_format: 'b64_json',
      });
    },
  );
});

describe('shared backend contract and PNG URL materialization', () => {
  const adapters = ['codex', 'openai'] as const;
  function backend(
    kind: (typeof adapters)[number],
    fetchImpl: typeof fetch,
  ): ImageBackend {
    return kind === 'codex'
      ? new CodexImageBackend({
          getCredential: async () => ({
            accessToken: 'secret',
            accountId: 'account',
          }),
          fetchImpl,
        })
      : new OpenAIImagesBackend({
          config: config('https://example.com/v1'),
          getApiKey: async () => 'secret',
          fetchImpl,
        });
  }
  it.each([...adapters])(
    '%s downloads PNG without forwarding credentials and rejects redirects',
    async (kind) => {
      const requests: Request[] = [];
      const options: Array<RequestInit | undefined> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        options.push(init);
        return request.method === 'POST'
          ? Response.json({
              data: [{ url: 'https://cdn.example/result?signature=private' }],
            })
          : new Response(png);
      };
      const result = await backend(kind, fetchImpl).generate(
        { prompt: 'lake' },
        signal(),
      );
      expect(result).toMatchObject({
        mimeType: 'image/png',
        encoding: 'base64',
      });
      expect(Buffer.from(result.data, 'base64')).toStrictEqual(png);
      expect(requests[1].headers.has('authorization')).toBe(false);
      expect(requests[1].headers.has('ChatGPT-Account-ID')).toBe(false);
      expect(requests[1].redirect).toBe('error');
      expect(options[1]?.credentials).toBe('omit');
    },
  );
  for (const kind of adapters) {
    it.each([
      'bad-png',
      'truncated-png',
      'bad-crc',
      'network',
      'status',
      'oversized',
      'redirect',
      'bad-scheme',
    ] as const)(
      `${kind} reports typed sanitized %s download failure`,
      async (failure) => {
        const fetchImpl: typeof fetch = async (_input, init) => {
          if (init?.method === 'POST')
            return Response.json({
              data: [
                {
                  url:
                    failure === 'bad-scheme'
                      ? 'file:///private/result'
                      : 'https://cdn.example/result?signature=private',
                },
              ],
            });
          if (failure === 'network')
            throw new Error('https://cdn.example/result?signature=private');
          if (failure === 'status') return new Response(null, { status: 403 });
          if (failure === 'redirect')
            return new Response(null, {
              status: 302,
              headers: { location: 'https://elsewhere.example' },
            });
          if (failure === 'oversized')
            return new Response(png, {
              headers: { 'content-length': String(30 * 1024 * 1024) },
            });
          if (failure === 'truncated-png')
            return new Response(png.subarray(0, 9));
          if (failure === 'bad-crc') {
            const corrupted = Buffer.from(png);
            corrupted[29] ^= 1;
            return new Response(corrupted);
          }
          return new Response('not a PNG');
        };
        const outcome: unknown = await backend(kind, fetchImpl)
          .generate({ prompt: 'lake' }, signal())
          .catch((error: unknown) => error);
        expect(outcome).toMatchObject({
          name: 'ImageBackendError',
          code: expect.stringMatching(/materialization|invalid_png/),
        });
        expect(String(outcome)).not.toContain('signature=private');
      },
    );
    it(`${kind} bounds streamed downloads even without Content-Length`, async () => {
      let cancelled = false;
      const fetchImpl: typeof fetch = async (_input, init) => {
        if (init?.method === 'POST')
          return Response.json({
            data: [{ url: 'https://cdn.example/result' }],
          });
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
            cancel() {
              cancelled = true;
            },
          }),
        );
      };
      await expect(
        backend(kind, fetchImpl).generate({ prompt: 'lake' }, signal()),
      ).rejects.toMatchObject({ code: 'materialization' });
      expect(cancelled).toBe(true);
    });
    it(`${kind} preserves caller cancellation during URL downloads`, async () => {
      const controller = new AbortController();
      const fetchImpl: typeof fetch = async (_input, init) => {
        if (init?.method === 'POST')
          return Response.json({
            data: [{ url: 'https://cdn.example/result' }],
          });
        controller.abort();
        init?.signal?.throwIfAborted();
        throw new Error('Expected cancellation to reach the download');
      };
      await expect(
        backend(kind, fetchImpl).generate(
          { prompt: 'lake' },
          controller.signal,
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  }
  it('keeps remote OpenAI generation overrides and multipart edits separate from Codex JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'issue3627-openai-'));
    try {
      const inputPath = join(directory, 'input.png');
      await writeFile(inputPath, png);
      const transport = http();
      const adapter = backend('openai', transport.fetchImpl);
      const request: ImageGenerateRequest = {
        prompt: 'lake',
        size: '1024x1536',
        quality: 'high',
        background: 'opaque',
      };
      await adapter.generate(request, signal());
      expect(await transport.requests[0].json()).toMatchObject({
        ...request,
        model: 'FLUX.2-klein',
        n: 1,
        response_format: 'b64_json',
      });
      await adapter.edit({ ...request, inputPaths: [inputPath] }, signal());
      const form = await transport.requests[1].formData();
      expect([...form.keys()].sort()).toStrictEqual([
        'background',
        'image[]',
        'model',
        'prompt',
        'quality',
        'size',
      ]);
      expect(transport.requests[1].headers.get('authorization')).toBe(
        'Bearer secret',
      );
      expect(transport.requests[1].headers.has('originator')).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
