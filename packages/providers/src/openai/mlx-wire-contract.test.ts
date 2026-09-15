/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference lib="es2022.object" />

import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageProfile } from '@vybestack/llxprt-code-settings';
import { createCodexImageBackendResolver } from './codexImageBackendResolver.js';
import { ImageBackendError } from './imageBackendResponse.js';
import {
  editSuccess,
  generationSuccess,
  handlerFailure,
  modelNotFound,
  timeoutFailure,
  tinyPngBase64,
  validationFailure,
} from './mlx-wire-fixtures.js';

function harness(
  body: unknown,
  status = 200,
  defaults?: ImageProfile['defaults'],
) {
  const requests: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(body, { status });
  };
  const backend = createCodexImageBackendResolver({
    oauthManager: undefined,
    getActiveProvider: () => undefined,
    getActiveImageProfile: () => ({
      version: 1,
      type: 'image',
      backend: 'openai-images',
      model: 'black-forest-labs/FLUX.2-klein-4B',
      baseUrl: 'http://127.0.0.1:8321/v1',
      auth: { type: 'none' },
      ...(defaults === undefined ? {} : { defaults }),
    }),
    fetchImpl,
  })();
  if (backend === null) throw new Error('Image profile did not resolve');
  return { backend, requests };
}

const signal = (): AbortSignal => new AbortController().signal;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe('pinned MLX wire contract', () => {
  it.each([
    {
      body: validationFailure,
      status: 422,
      code: 'validation',
      message: /body\.size.*Input should be '256x256'/,
    },
    {
      body: handlerFailure,
      status: 500,
      code: 'server_error',
      message: /concatenate\(\): incompatible function arguments/,
    },
    {
      body: timeoutFailure,
      status: 500,
      code: 'timeout',
      message: /timed out/i,
    },
    {
      body: modelNotFound,
      status: 404,
      code: 'model_not_found',
      message: /nonexistent\/model.*not found/,
    },
  ])(
    'surfaces readable $code errors with HTTP $status',
    async ({ body, status, code, message }) => {
      const { backend } = harness(body, status);
      const operation = backend.generate({ prompt: 'a sailboat' }, signal());
      await expect(operation).rejects.toBeInstanceOf(ImageBackendError);
      await expect(operation).rejects.toMatchObject({
        code,
        status,
        message: expect.stringMatching(message),
      });
    },
  );

  it('does not expose FastAPI raw input or context in validation errors', async () => {
    const { backend } = harness(
      {
        detail: [
          {
            ...validationFailure.detail[0],
            input: 'private-prompt',
            ctx: { secret: 'private-context' },
          },
        ],
      },
      422,
    );
    const outcome: unknown = await backend
      .generate({ prompt: 'a sailboat' }, signal())
      .catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(ImageBackendError);
    expect(String(outcome)).not.toContain('private-prompt');
    expect(String(outcome)).not.toContain('private-context');
  });

  it('decodes a generation envelope with null url into PNG bytes without inventing usage', async () => {
    const { backend } = harness(generationSuccess);
    const result = await backend.generate({ prompt: 'a sailboat' }, signal());
    expect(result).toMatchObject({ encoding: 'base64', mimeType: 'image/png' });
    expect(Buffer.from(result.data, 'base64').subarray(0, 8)).toStrictEqual(
      signature,
    );
    expect(Object.hasOwn(result, 'usage')).toBe(false);
  });

  it('rejects an inline non-PNG payload with a typed error', async () => {
    const { backend } = harness({
      ...generationSuccess,
      data: [
        { url: null, b64_json: Buffer.from('not a PNG').toString('base64') },
      ],
    });
    await expect(
      backend.generate({ prompt: 'a sailboat' }, signal()),
    ).rejects.toMatchObject({ name: 'ImageBackendError', code: 'invalid_png' });
  });

  it.each([undefined, '256x256'] as const)(
    'sends only MLX generation vocabulary with profile size %s',
    async (size) => {
      const { backend, requests } = harness(generationSuccess, 200, {
        quality: 'max',
        background: 'auto',
        ...(size === undefined ? {} : { size }),
      });
      await backend.generate({ prompt: 'a sailboat' }, signal());
      const body: unknown = await requests[0].json();
      expect(body).toStrictEqual({
        model: 'black-forest-labs/FLUX.2-klein-4B',
        prompt: 'a sailboat',
        n: 1,
        ...(size === undefined ? {} : { size }),
      });
      if (typeof body !== 'object' || body === null)
        throw new Error('Expected JSON object');
      expect(Object.hasOwn(body, 'size')).toBe(size !== undefined);
      for (const field of [
        'quality',
        'background',
        'auto',
        'url',
        'response_format',
        'mask',
      ]) {
        expect(Object.hasOwn(body, field)).toBe(false);
      }
    },
  );

  it('decodes the pinned multipart edit response into a PNG', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'issue3627e-edit-'));
    try {
      const inputPath = join(directory, 'input.png');
      await writeFile(inputPath, Buffer.from(tinyPngBase64, 'base64'));
      const { backend } = harness(editSuccess);
      const result = await backend.edit(
        { prompt: 'add a lighthouse', inputPaths: [inputPath] },
        signal(),
      );
      expect(result).toMatchObject({
        encoding: 'base64',
        mimeType: 'image/png',
      });
      expect(Buffer.from(result.data, 'base64').subarray(0, 8)).toStrictEqual(
        signature,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
