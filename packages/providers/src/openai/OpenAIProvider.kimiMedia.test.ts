/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { bindProviderFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderFiles.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { describe, expect, it, vi } from 'bun:test';
import type OpenAI from 'openai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { bindProviderAliasIdentity } from '../composition/aliasProviderFactory.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import type { ChatRowInput } from './OpenAIRequestPreparation.js';
import type { RowsMediaInput } from '../openai-responses/responses-row-media.js';

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

/**
 * The media pre-pass runs after request normalization, when the call carries
 * its rows as `requestRows` rather than as the caller's cold stream.
 */
function createNormalizedOptions(
  init: Parameters<typeof createProviderCallOptions>[0] & {
    contents: IContent[];
  },
): NormalizedGenerateChatOptions {
  return {
    ...createProviderCallOptions(init),
    contents: [],
    requestRows: rowsSelection(init.contents),
    contentCount: init.contents.length,
  } as NormalizedGenerateChatOptions;
}

async function rowsOf(input: ChatRowInput | undefined): Promise<IContent[]> {
  if (input?.rows === undefined) throw new Error('expected prepared rows');
  const rows: IContent[] = [];
  for await (const row of input.rows.rows()) rows.push(row);
  return rows;
}

type KimiMediaProcessor = {
  maybeProcessKimiMedia(
    options: NormalizedGenerateChatOptions,
    client: OpenAI,
    logger: DebugLogger,
    mediaRequest: ResolvedMediaRequest,
    media: RowsMediaInput,
  ): Promise<ChatRowInput | undefined>;
};

const MEDIA_INPUT: RowsMediaInput = { requestId: 'provider-request' };

describe('OpenAIProvider Kimi media preprocessing', () => {
  it('leaves video unchanged while the experimental setting is disabled', async () => {
    const filesCreate = vi.fn();
    const client = {
      apiKey: 'test-key',
      baseURL: 'https://api.kimi.com/coding/v1',
      files: { create: filesCreate },
    } as unknown as OpenAI;
    const provider = createProvider();
    const options = createNormalizedOptions({
      providerName: provider.name,
      contents: createContents(),
      configOverrides: { getTargetDir: () => '/workspace/kimi-media' },
    });

    const mediaRequest = await resolveRequestMedia(MEDIA_INPUT, [], undefined);
    const result = await (
      provider as unknown as KimiMediaProcessor
    ).maybeProcessKimiMedia(
      options,
      client,
      new DebugLogger('test:kimi-media'),
      mediaRequest,
      MEDIA_INPUT,
    );
    await mediaRequest.release();

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
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
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 10,
      maxBytes: 1024,
    });
    const provider = bindProviderFiles(
      createProvider(),
      undefined,
      lifecycle,
      '/workspace/kimi-media',
    );
    const settings = new SettingsService();
    settings.set('kimi.experimental-video', true);
    settings.set('provider-files', 'workspace');
    const options = createNormalizedOptions({
      providerName: provider.name,
      contents: createContents(),
      settings,
      invocation: createRuntimeInvocationContext({
        runtimeId: 'kimi-media',
        providerName: 'kimi',
        ephemeralsSnapshot: { ...settings.getAllGlobalSettings() },
        providerDefaults: {
          providerSpecific: {
            mediaSupport: {
              fileUpload: true,
              videoSupport: true,
              inlineImages: true,
            },
          },
        },
      }),
      runtime: {
        settingsService: settings,
        providerFileLifecycle: new ProviderFileLifecycle({
          maxFiles: 10,
          maxBytes: 1024,
        }),
      },
      configOverrides: { getTargetDir: () => '/workspace/kimi-media' },
    });

    const mediaRequest = await resolveRequestMedia(MEDIA_INPUT, [], undefined);
    const result = await (
      provider as unknown as KimiMediaProcessor
    ).maybeProcessKimiMedia(
      options,
      client,
      new DebugLogger('test:kimi-media'),
      mediaRequest,
      MEDIA_INPUT,
    );
    await mediaRequest.release();

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(filesCreate.mock.calls[0][0].purpose).toBe('video');
    const rows = await rowsOf(result);
    expect(rows[0].blocks[1]).toStrictEqual({
      type: 'media',
      mimeType: 'video/mp4',
      data: 'ms://video-file',
      encoding: 'url',
      filename: 'clip.mp4',
    });
  });
});
