/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type OpenAI from 'openai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { bindProviderAliasIdentity } from '../composition/aliasProviderFactory.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { upsertRuntimeEntry } from '../runtime/runtimeRegistry.js';

function createProvider(): OpenAIProvider {
  const provider = new OpenAIProvider(
    'test-key',
    'https://api.kimi.com/coding/v1',
    {
      providerSpecific: {
        mediaSupport: {
          inlineImages: true,
          fileUpload: true,
          videoSupport: true,
        },
      },
    },
  );
  bindProviderAliasIdentity(provider, 'kimi');
  Object.defineProperty(provider, 'getMediaTransportCapabilities', {
    value: () => declaredMediaTransportCapabilities('kimi'),
    writable: false,
    enumerable: false,
    configurable: true,
  });
  return provider;
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
    mediaRequest: ResolvedMediaRequest,
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
      configOverrides: { getTargetDir: () => '/workspace/kimi-media' },
    });

    const mediaRequest = await resolveRequestMedia(
      undefined,
      options.contents,
      undefined,
    );
    const result = await (
      provider as unknown as KimiMediaProcessor
    ).maybeProcessKimiMedia(
      options,
      client,
      new DebugLogger('test:kimi-media'),
      mediaRequest,
    );
    await mediaRequest.release();

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
    const settings = new SettingsService();
    settings.set('kimi.experimental-video', true);
    settings.set('provider-files', 'workspace');
    const options = createProviderCallOptions({
      providerName: provider.name,
      contents: createContents(),
      settings,
      configOverrides: { getTargetDir: () => '/workspace/kimi-media' },
    });
    upsertRuntimeEntry(options.invocation.runtimeId, {});

    const mediaRequest = await resolveRequestMedia(
      undefined,
      options.contents,
      undefined,
    );
    const result = await (
      provider as unknown as KimiMediaProcessor
    ).maybeProcessKimiMedia(
      options,
      client,
      new DebugLogger('test:kimi-media'),
      mediaRequest,
    );
    await mediaRequest.release();

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
});
