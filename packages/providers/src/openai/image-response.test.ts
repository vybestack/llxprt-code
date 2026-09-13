/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  parseImageResponse,
  imageResponseError,
} from './imageBackendResponse.js';
import { generationSuccess } from './mlx-wire-fixtures.js';
const signal = new AbortController().signal;
const fetchImage: typeof fetch = async () =>
  new Response(Buffer.from(generationSuccess.data[0].b64_json, 'base64'));
describe('image transport validation', () => {
  it.each(['169.254.169.254', '10.0.0.1', 'fe80::1', '::ffff:169.254.169.254'])(
    'rejects a public hostname resolving to %s',
    async (address) => {
      const resolveHostname = async () => [
        { address: '8.8.8.8', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ];
      await expect(
        parseImageResponse(
          { data: [{ url: 'https://images.example/image' }] },
          fetchImage,
          signal,
          { resolveHostname },
        ),
      ).rejects.toMatchObject({
        name: 'ImageBackendError',
        code: 'materialization',
      });
    },
  );

  it('downloads when DNS resolves only to public addresses', async () => {
    const resolveHostname = async () => [{ address: '8.8.8.8', family: 4 }];
    expect(
      (
        await parseImageResponse(
          { data: [{ url: 'https://images.example/image' }] },
          fetchImage,
          signal,
          { resolveHostname },
        )
      ).mimeType,
    ).toBe('image/png');
  });

  it('skips DNS validation for opted-in local downloads', async () => {
    let resolutions = 0;
    const resolveHostname = async () => {
      resolutions++;
      return [{ address: '169.254.169.254', family: 4 }];
    };
    expect(
      (
        await parseImageResponse(
          { data: [{ url: 'http://lan.example/image' }] },
          fetchImage,
          signal,
          { allowLocalUrls: true, resolveHostname },
        )
      ).mimeType,
    ).toBe('image/png');
    expect(resolutions).toBe(0);
  });

  it.each([
    ['image/jpeg', Buffer.from([255, 216, 255, 0])],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
  ] as const)('sniffs %s URL bytes', async (mimeType, bytes) => {
    expect(
      (
        await parseImageResponse(
          { data: [{ url: 'https://images.example/image' }] },
          async () => new Response(bytes),
          signal,
        )
      ).mimeType,
    ).toBe(mimeType);
  });

  it('rejects garbage URL bytes with a typed image error', async () => {
    await expect(
      parseImageResponse(
        { data: [{ url: 'https://images.example/image' }] },
        async () => new Response('garbage'),
        signal,
      ),
    ).rejects.toMatchObject({
      name: 'ImageBackendError',
      code: 'invalid_png',
      message: expect.stringContaining('PNG, JPEG, or WebP'),
    });
  });
  it.each([
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/jpeg', Buffer.from([255, 216, 255, 0])],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
  ] as const)('sniffs %s base64 bytes', async (mimeType, bytes) => {
    expect(
      (
        await parseImageResponse(
          { data: [{ b64_json: bytes.toString('base64') }] },
          fetchImage,
          signal,
        )
      ).mimeType,
    ).toBe(mimeType);
  });
  it.each(['garbage', '!!!!', 'aGVsbG8='])(
    'rejects invalid image base64 %s',
    async (data) => {
      await expect(
        parseImageResponse({ data: [{ b64_json: data }] }, fetchImage, signal),
      ).rejects.toMatchObject({ code: 'invalid_image' });
    },
  );
  it.each([
    'http://localhost/image',
    'https://127.0.0.1/image',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/image',
    'https://172.16.0.1/image',
    'https://192.168.1.1/image',
    'https://[fc00::1]/image',
    'https://[fe80::1]/image',
    'https://[::ffff:127.0.0.1]/image',
    'http://images.example/image',
    'https://metadata.google.internal/image',
  ])('rejects remote download %s', async (url) => {
    await expect(
      parseImageResponse({ data: [{ url }] }, fetchImage, signal),
    ).rejects.toMatchObject({ code: 'materialization' });
  });
  it('allows public HTTPS downloads', async () => {
    expect(
      (
        await parseImageResponse(
          { data: [{ url: 'https://images.example/image' }] },
          fetchImage,
          signal,
        )
      ).mimeType,
    ).toBe('image/png');
  });
  it('allows local downloads only when opted in', async () => {
    expect(
      (
        await parseImageResponse(
          { data: [{ url: 'http://localhost/image' }] },
          fetchImage,
          signal,
          { allowLocalUrls: true },
        )
      ).mimeType,
    ).toBe('image/png');
  });
  it('classifies model_not_found before the timeout heuristic', () => {
    expect(
      imageResponseError(
        { error: { type: 'model_not_found', message: '' } },
        500,
      ).code,
    ).toBe('model_not_found');
  });
  it('preserves unknown fetch causes', async () => {
    const cause = new Error('transport failed');
    await expect(
      parseImageResponse(
        { data: [{ url: 'https://images.example/image' }] },
        async () => {
          throw cause;
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'materialization', cause });
  });
  it('preserves abort errors', async () => {
    const cause = new DOMException('aborted', 'AbortError');
    await expect(
      parseImageResponse(
        { data: [{ url: 'https://images.example/image' }] },
        async () => {
          throw cause;
        },
        signal,
      ),
    ).rejects.toBe(cause);
  });
});
