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
import {
  createCodexImageBackendResolver,
  resolveImageProfileBackendConfig,
} from './codexImageBackendResolver.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const signal = (): AbortSignal => new AbortController().signal;
function config(baseUrl = 'http://localhost:8321/v1') {
  return resolveImageProfileBackendConfig({
    version: 1,
    type: 'image',
    backend: 'openai-images',
    model: 'FLUX.2-klein',
    baseUrl,
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
