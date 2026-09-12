/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { createCodexImageBackendResolver } from './codexImageBackendResolver.js';

// Opt in with LLXPRT_MLX_SMOKE=1 LLXPRT_MLX_BASE_URL=http://127.0.0.1:8321/v1.
const enabled =
  process.env.LLXPRT_MLX_SMOKE === '1' &&
  Boolean(process.env.LLXPRT_MLX_BASE_URL?.trim());

it.skipIf(!enabled)(
  'generates a 256x256 PNG through a local image profile',
  async () => {
    const baseUrl = process.env.LLXPRT_MLX_BASE_URL;
    if (baseUrl === undefined || baseUrl.trim() === '') {
      throw new Error('LLXPRT_MLX_BASE_URL is required');
    }
    const backend = createCodexImageBackendResolver({
      oauthManager: undefined,
      getActiveProvider: () => undefined,
      getActiveImageProfile: () => ({
        version: 1,
        type: 'image',
        backend: 'openai-images',
        model: 'black-forest-labs/FLUX.2-klein-4B',
        baseUrl,
        auth: { type: 'none' },
        defaults: { size: '256x256' },
      }),
    })();
    if (backend === null)
      throw new Error('Local image profile did not resolve');
    const result = await backend.generate(
      { prompt: 'A small red sailboat on calm water, photorealistic' },
      AbortSignal.timeout(300_000),
    );
    expect(result.data).toBeDefined();
    if (result.data === undefined) throw new Error('Expected image data');
    const bytes = Buffer.from(result.data, 'base64');
    expect(result).toMatchObject({ mimeType: 'image/png', encoding: 'base64' });
    expect(bytes.subarray(0, 8)).toStrictEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
    expect(bytes.readUInt32BE(16)).toBe(256);
    expect(bytes.readUInt32BE(20)).toBe(256);
  },
  310_000,
);
