/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CodexImageBackend,
  buildCodexImageEditEndpoint,
  CODEX_IMAGE_MODEL,
} from './codexImageBackend.js';
import { ImageValidationError } from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';

/**
 * Runs `operation` expecting rejection and returns the rejection reason.
 * Fails closed by throwing if the operation fulfills, so tests cannot pass
 * silently when the promise resolves with an Error-shaped value.
 */
const NOT_REJECTED = Symbol('not-rejected');

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  const outcome: unknown = await operation.then(
    () => NOT_REJECTED,
    (error: unknown) => error,
  );
  if (outcome === NOT_REJECTED) {
    throw new Error('expected the operation to reject');
  }
  return outcome;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngCrc32(buf: Buffer): number {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0xff_ff_ff_ff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function makeRealMinimalPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rawScanline = Buffer.from([0x00, 0xff, 0x00, 0x00]);
  const zlibHeader = Buffer.from([0x78, 0x01]);
  const storedBlockHeader = Buffer.from([0x01]);
  const storedLen = Buffer.alloc(2);
  storedLen.writeUInt16LE(rawScanline.length, 0);
  const storedNlen = Buffer.alloc(2);
  storedNlen.writeUInt16LE(~rawScanline.length & 0xffff, 0);
  let a = 1;
  let b = 0;
  for (const byte of rawScanline) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler, 0);
  const idatData = Buffer.concat([
    zlibHeader,
    storedBlockHeader,
    storedLen,
    storedNlen,
    rawScanline,
    checksum,
  ]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function makeStubFetch(response: { status: number; body: unknown }): {
  fetchImpl: typeof fetch;
  captured: () => CapturedRequest | undefined;
} {
  let captured: CapturedRequest | undefined;
  const fetchImpl: typeof fetch = async (input, init?) => {
    const url = typeof input === 'string' ? input : input.toString();
    captured = { url, init: init ?? {} };
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
}): CodexImageBackend {
  return new CodexImageBackend({
    getCredential: async () => ({
      accessToken: 'token-abc',
      accountId: 'account-xyz',
    }),
    getBaseUrl: overrides?.getBaseUrl ?? (() => undefined),
    fetchImpl: overrides?.fetchImpl ?? fetch,
  });
}

describe('buildCodexImageEditEndpoint', () => {
  it('returns the canonical edit endpoint when no base url is given', () => {
    expect(buildCodexImageEditEndpoint(undefined)).toBe(
      'https://chatgpt.com/backend-api/codex/images/edits',
    );
  });

  it('derives the edit endpoint from a codex base url', () => {
    expect(
      buildCodexImageEditEndpoint('https://chatgpt.com/backend-api/codex'),
    ).toBe('https://chatgpt.com/backend-api/codex/images/edits');
  });
});

describe('CodexImageBackend.edit', () => {
  let workspaceRoot = '';
  beforeEach(async () => {
    workspaceRoot = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), 'llxprt-image-edit-')),
    );
  });
  afterEach(async () => {
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('posts to the edit endpoint with model gpt-image-2 and input images as data URLs', async () => {
    const inputPng = makeRealMinimalPng();
    const inputPath = path.join(workspaceRoot, 'input.png');
    await fs.promises.writeFile(inputPath, inputPng);

    const { fetchImpl, captured } = makeStubFetch({
      status: 200,
      body: { data: [{ b64_json: 'aGVsbG8=' }] },
    });
    const backend = makeBackend({ fetchImpl });

    await backend.edit(
      { prompt: 'add a mouse', inputPaths: [inputPath] },
      new AbortController().signal,
    );

    const req = captured();
    expect(req).toBeDefined();
    expect(req?.init.method).toBe('POST');
    expect(req?.url).toBe('https://chatgpt.com/backend-api/codex/images/edits');

    const body = JSON.parse(req?.init.body as string) as Record<
      string,
      unknown
    >;
    expect(body['model']).toBe('gpt-image-2');
    expect(body['prompt']).toBe('add a mouse');
    // The Codex /images/edits contract requires `images: [{ image_url }]`.
    // A bare string array or the singular `image` key is rejected with
    // 400 missing_required_parameter.
    expect(body['image']).toBeUndefined();
    expect(Array.isArray(body['images'])).toBe(true);
    const images = body['images'] as Array<{ image_url: string }>;
    expect(images).toHaveLength(1);
    expect(images[0].image_url).toMatch(/^data:image\/png;base64,/);
    expect(body['background']).toBe('auto');
    expect(body['quality']).toBe('auto');
    expect(body['size']).toBe('auto');
    // The edit contract must NOT include generate-only keys.
    expect(body['n']).toBeUndefined();
    // The body must contain ONLY the documented edit keys.
    expect(Object.keys(body).sort()).toStrictEqual(
      ['background', 'images', 'model', 'prompt', 'quality', 'size'].sort(),
    );
  });

  it('includes the full header set on edit', async () => {
    const inputPath = path.join(workspaceRoot, 'input.png');
    await fs.promises.writeFile(inputPath, makeRealMinimalPng());

    const { fetchImpl, captured } = makeStubFetch({
      status: 200,
      body: { data: [{ b64_json: 'aGVsbG8=' }] },
    });
    const backend = makeBackend({ fetchImpl });

    await backend.edit(
      { prompt: 'edit', inputPaths: [inputPath] },
      new AbortController().signal,
    );

    const headers = captured()?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token-abc');
    expect(headers['ChatGPT-Account-ID']).toBe('account-xyz');
    expect(headers['originator']).toBe('codex_cli_rs');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('normalizes the edit response into a base64/png result', async () => {
    const inputPath = path.join(workspaceRoot, 'input.png');
    await fs.promises.writeFile(inputPath, makeRealMinimalPng());

    const { fetchImpl } = makeStubFetch({
      status: 200,
      body: { data: [{ b64_json: 'aGVsbG8=' }] },
    });
    const backend = makeBackend({ fetchImpl });

    const result = await backend.edit(
      { prompt: 'edit it', inputPaths: [inputPath] },
      new AbortController().signal,
    );

    expect(result.mimeType).toBe('image/png');
    expect(result.encoding).toBe('base64');
    expect(result.data).toBe('aGVsbG8=');
    expect(result.caption).toBe('edit it');
  });

  it('rejects zero input paths for an edit', async () => {
    const backend = makeBackend();
    expect(
      await captureRejection(
        backend.edit(
          { prompt: 'edit', inputPaths: [] },
          new AbortController().signal,
        ),
      ),
    ).toBeInstanceOf(ImageValidationError);
  });

  it('rejects more than five input paths', async () => {
    const paths: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = path.join(workspaceRoot, `input${i}.png`);
      await fs.promises.writeFile(p, makeRealMinimalPng());
      paths.push(p);
    }
    const backend = makeBackend();
    expect(
      await captureRejection(
        backend.edit(
          { prompt: 'edit', inputPaths: paths },
          new AbortController().signal,
        ),
      ),
    ).toBeInstanceOf(ImageValidationError);
  });

  it('rejects an empty prompt before any file read or fetch', async () => {
    let fetchCalled = false;
    const fetchImpl: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    };
    const backend = makeBackend({ fetchImpl });
    expect(
      await captureRejection(
        backend.edit(
          { prompt: '   ', inputPaths: [path.join(workspaceRoot, 'x.png')] },
          new AbortController().signal,
        ),
      ),
    ).toBeInstanceOf(ImageValidationError);
    expect(fetchCalled).toBe(false);
  });

  it('rejects a URL input path', async () => {
    const backend = makeBackend();
    expect(
      await captureRejection(
        backend.edit(
          { prompt: 'edit', inputPaths: ['https://example.com/img.png'] },
          new AbortController().signal,
        ),
      ),
    ).toMatchObject({ message: expect.stringMatching(/URL/i) });
  });

  it('rejects a non-image input file', async () => {
    const txtPath = path.join(workspaceRoot, 'notimage.txt');
    await fs.promises.writeFile(txtPath, 'hello');
    const backend = makeBackend();
    expect(
      await captureRejection(
        backend.edit(
          { prompt: 'edit', inputPaths: [txtPath] },
          new AbortController().signal,
        ),
      ),
    ).toMatchObject({
      message: expect.stringMatching(/unsupported|unrecognized|not a regular/i),
    });
  });

  it('surfaces a non-2xx edit response as ImageGenerationError', async () => {
    const inputPath = path.join(workspaceRoot, 'input.png');
    await fs.promises.writeFile(inputPath, makeRealMinimalPng());
    const { fetchImpl } = makeStubFetch({
      status: 429,
      body: { error: 'rate limited' },
    });
    const backend = makeBackend({ fetchImpl });
    expect(
      await captureRejection(
        backend.edit(
          { prompt: 'edit', inputPaths: [inputPath] },
          new AbortController().signal,
        ),
      ),
    ).toMatchObject({
      name: 'ImageGenerationError',
      status: 429,
    });
  });

  it('forces model gpt-image-2 on edit', async () => {
    const inputPath = path.join(workspaceRoot, 'input.png');
    await fs.promises.writeFile(inputPath, makeRealMinimalPng());
    const { fetchImpl, captured } = makeStubFetch({
      status: 200,
      body: { data: [{ b64_json: 'aGVsbG8=' }] },
    });
    const backend = makeBackend({ fetchImpl });
    await backend.edit(
      {
        prompt: 'edit',
        inputPaths: [inputPath],
        model: 'gpt-evil',
      } as never,
      new AbortController().signal,
    );
    const body = JSON.parse(captured()?.init.body as string) as Record<
      string,
      unknown
    >;
    expect(body['model']).toBe(CODEX_IMAGE_MODEL);
  });

  it('propagates abort on edit', async () => {
    const inputPath = path.join(workspaceRoot, 'input.png');
    await fs.promises.writeFile(inputPath, makeRealMinimalPng());
    const { fetchImpl } = makeStubFetch({
      status: 200,
      body: { data: [{ b64_json: 'aGVsbG8=' }] },
    });
    const backend = makeBackend({ fetchImpl });
    const controller = new AbortController();
    controller.abort();
    expect(
      await captureRejection(
        backend.edit(
          { prompt: 'edit', inputPaths: [inputPath] },
          controller.signal,
        ),
      ),
    ).toMatchObject({ message: expect.stringContaining('aborted') });
  });

  it('rejects a RIFF file that is NOT WebP (e.g. WAV renamed .webp)', async () => {
    // A RIFF container whose bytes 8..12 are NOT "WEBP" must be rejected,
    // not misclassified as image/webp.
    const wavBytes = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]), // "RIFF"
      Buffer.alloc(4), // file size (dummy)
      Buffer.from([0x57, 0x41, 0x56, 0x45]), // "WAVE" (not "WEBP")
      Buffer.alloc(16), // padding
    ]);
    const inputPath = path.join(workspaceRoot, 'fake.webp');
    await fs.promises.writeFile(inputPath, wavBytes);
    const backend = makeBackend();
    expect(
      await captureRejection(
        backend.edit(
          { prompt: 'edit', inputPaths: [inputPath] },
          new AbortController().signal,
        ),
      ),
    ).toMatchObject({
      message: expect.stringMatching(/unsupported|unrecognized/i),
    });
  });

  it('accepts a valid WebP file as an input image', async () => {
    // A real WebP file: RIFF + size + "WEBP" + VP8 chunk header.
    const webpBytes = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]), // "RIFF"
      Buffer.alloc(4), // file size (dummy)
      Buffer.from([0x57, 0x45, 0x42, 0x50]), // "WEBP"
      Buffer.alloc(16), // VP8 chunk (dummy, not parsed)
    ]);
    const inputPath = path.join(workspaceRoot, 'valid.webp');
    await fs.promises.writeFile(inputPath, webpBytes);
    const { fetchImpl, captured } = makeStubFetch({
      status: 200,
      body: { data: [{ b64_json: 'aGVsbG8=' }] },
    });
    const backend = makeBackend({ fetchImpl });

    await backend.edit(
      { prompt: 'edit', inputPaths: [inputPath] },
      new AbortController().signal,
    );

    const req = captured();
    // The body must contain a data URL with image/webp MIME.
    const body = JSON.parse(req?.init.body as string) as Record<
      string,
      unknown
    >;
    const images = body['images'] as Array<{ image_url: string }>;
    expect(images[0].image_url).toMatch(/^data:image\/webp;base64,/);
  });
});
