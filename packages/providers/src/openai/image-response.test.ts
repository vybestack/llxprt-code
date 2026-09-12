/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import {
  parseImageResponse,
  imageResponseError,
} from './imageBackendResponse.js';
import { generationSuccess } from './mlx-wire-fixtures.js';
const signal = new AbortController().signal;
const fetchImage: typeof fetch = async () =>
  new Response(Buffer.from(generationSuccess.data[0].b64_json, 'base64'));
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
    imageResponseError({ error: { type: 'model_not_found', message: '' } }, 500)
      .code,
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
