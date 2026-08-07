/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type OpenAI from 'openai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

function createProvider(): OpenAIProvider {
  return new OpenAIProvider('test-key', 'https://api.kimi.com/coding/v1', {
    providerSpecific: {
      mediaSupport: {
        inlineImages: true,
        fileUpload: true,
        videoSupport: true,
      },
    },
  });
}

function createContents(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'Describe this video' },
        {
          type: 'media',
          mimeType: 'video/mp4',
          data: 'VklERU8=',
          encoding: 'base64',
          filename: 'clip.mp4',
        },
      ],
    },
  ];
}

type KimiMediaProcessor = {
  maybeProcessKimiMedia(
    options: NormalizedGenerateChatOptions,
    client: OpenAI,
    logger: DebugLogger,
  ): Promise<NormalizedGenerateChatOptions>;
};

describe('OpenAIProvider Kimi media preprocessing', () => {
  it('leaves video unchanged while the experimental setting is disabled', async () => {
    const filesCreate = vi.fn();
    const client = {
      apiKey: 'test-key',
      baseURL: 'https://api.kimi.com/coding/v1',
      files: { create: filesCreate },
    } as unknown as OpenAI;
    const provider = createProvider();
    const options = createProviderCallOptions({
      providerName: provider.name,
      contents: createContents(),
    });

    const result = await (
      provider as unknown as KimiMediaProcessor
    ).maybeProcessKimiMedia(
      options,
      client,
      new DebugLogger('test:kimi-media'),
    );

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result).toBe(options);
    expect(result.contents[0].blocks[1]).toStrictEqual({
      type: 'media',
      mimeType: 'video/mp4',
      data: 'VklERU8=',
      encoding: 'base64',
      filename: 'clip.mp4',
    });
  });

  it('uploads enabled video and creates a Moonshot file reference', async () => {
    const filesCreate = vi.fn().mockResolvedValue({
      id: 'video-file',
      bytes: 5,
    });
    const client = {
      apiKey: 'test-key',
      baseURL: 'https://api.kimi.com/coding/v1',
      files: { create: filesCreate },
    } as unknown as OpenAI;
    const provider = createProvider();
    const options = createProviderCallOptions({
      providerName: provider.name,
      contents: createContents(),
    });
    options.settings.set('kimi.experimental-video', true);

    const result = await (
      provider as unknown as KimiMediaProcessor
    ).maybeProcessKimiMedia(
      options,
      client,
      new DebugLogger('test:kimi-media'),
    );

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(filesCreate.mock.calls[0][0].purpose).toBe('video');
    expect(result.contents[0].blocks[1]).toStrictEqual({
      type: 'media',
      mimeType: 'video/mp4',
      data: 'ms://video-file',
      encoding: 'url',
      filename: 'clip.mp4',
    });
  });

  it('falls back to inline video when the upload rejects', async () => {
    const filesCreate = vi.fn().mockRejectedValue(new Error('rate limited'));
    const client = {
      apiKey: 'fallback-key',
      baseURL: 'https://api.kimi.com/coding/v1',
      files: { create: filesCreate },
    } as unknown as OpenAI;
    const provider = createProvider();
    const options = createProviderCallOptions({
      providerName: provider.name,
      contents: createContents(),
    });
    options.settings.set('kimi.experimental-video', true);

    const result = await (
      provider as unknown as KimiMediaProcessor
    ).maybeProcessKimiMedia(
      options,
      client,
      new DebugLogger('test:kimi-media'),
    );

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(result).toBe(options);
    expect(result.contents[0].blocks[1]).toStrictEqual({
      type: 'media',
      mimeType: 'video/mp4',
      data: 'VklERU8=',
      encoding: 'base64',
      filename: 'clip.mp4',
    });
  });
});
