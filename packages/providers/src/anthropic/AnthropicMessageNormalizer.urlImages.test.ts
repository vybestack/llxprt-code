/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the zai url-image guard (#3693).
 *
 * zai's Anthropic-compatible endpoint rejects `source:{type:'url'}` image
 * blocks with a 400, while native Anthropic accepts them. These tests prove
 * both directions of the `supportsUrlImages` flag end to end through the real
 * conversion path:
 * - default (native): url images serialize as url sources exactly as before
 * - zai: url images serialize as the unsupported-media text placeholder,
 *   both in human messages and tool results, while base64 images and
 *   url-encoded PDFs are untouched
 * - request preparation derives the flag from the resolved base URL, so the
 *   final request body sent to a zai endpoint never contains an image url
 *   source.
 */

import { describe, expect, it, vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertToAnthropicMessages } from './AnthropicMessageNormalizer.js';
import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';

// Light boundary mock: prepareAnthropicRequest builds the real system prompt
// asynchronously; stub it so the request-prep tests stay deterministic and
// network-free. This is the only mock — no SDK, no HTTP.
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

const noopLogger = { debug: () => {} };

function urlImageBlock(): MediaBlock {
  return {
    type: 'media',
    mimeType: 'image/jpeg',
    data: 'https://example.com/photo.jpg',
    encoding: 'url' as const,
  };
}

function base64ImageBlock(): MediaBlock {
  // 1x1 PNG
  return {
    type: 'media',
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    encoding: 'base64' as const,
  };
}

function urlPdfBlock(): MediaBlock {
  return {
    type: 'media',
    mimeType: 'application/pdf',
    data: 'https://example.com/doc.pdf',
    encoding: 'url' as const,
  };
}

function humanWithMedia(...media: MediaBlock[]): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'look at this' }, ...media],
  };
}

function toolResultWithMedia(...media: MediaBlock[]): IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'read the file' }] },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'read_file',
          parameters: { path: 'photo.jpg' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'read_file',
          result: 'file read',
        },
        ...media,
      ],
    },
  ];
}

function convert(contents: IContent[], supportsUrlImages?: boolean) {
  return convertToAnthropicMessages(contents, {
    isOAuth: false,
    reasoningEnabled: false,
    config: undefined,
    unprefixToolName: (name: string) => name,
    logger: noopLogger,
    ...(supportsUrlImages === undefined
      ? {}
      : {
          supportsUrlImages,
        }),
  });
}

function userContentBlocks(messages: AnthropicMessage[]): unknown[] {
  const userMessages = messages.filter((m) => m.role === 'user');
  const blocks: unknown[] = [];
  for (const message of userMessages) {
    if (typeof message.content === 'string') {
      blocks.push({ type: 'text', text: message.content });
    } else {
      blocks.push(...message.content);
    }
  }
  return blocks;
}

function stringifyAll(messages: AnthropicMessage[]): string {
  return JSON.stringify(messages);
}

describe('convertToAnthropicMessages url-image serialization (#3693)', () => {
  it('serializes url images as url sources by default (native Anthropic behavior)', () => {
    const messages = convert([humanWithMedia(urlImageBlock())]);

    const image = userContentBlocks(messages).find(
      (b) => (b as { type?: string }).type === 'image',
    ) as
      | {
          source: { type: string; url?: string };
        }
      | undefined;
    expect(image).toBeDefined();
    expect(image!.source.type).toBe('url');
    expect(image!.source.url).toBe('https://example.com/photo.jpg');
  });

  it('serializes url images as url sources when supportsUrlImages is true', () => {
    const messages = convert([humanWithMedia(urlImageBlock())], true);

    expect(stringifyAll(messages)).toContain('"type":"url"');
  });

  it('replaces url images with the unsupported-media placeholder when supportsUrlImages is false', () => {
    const messages = convert([humanWithMedia(urlImageBlock())], false);

    const serialized = stringifyAll(messages);
    expect(serialized).not.toContain('"type":"url"');
    expect(serialized).not.toContain('https://example.com/photo.jpg');
    const placeholder = userContentBlocks(messages).find(
      (b) =>
        (b as { type?: string }).type === 'text' &&
        String((b as { text: string }).text).includes('[Unsupported image:'),
    ) as { text: string } | undefined;
    expect(placeholder).toBeDefined();
    expect(placeholder!.text).toContain('image/jpeg');
    expect(placeholder!.text).toContain('Anthropic does not support image');
  });

  it('keeps base64 image blocks unchanged when supportsUrlImages is false', () => {
    const block = base64ImageBlock();
    const messages = convert([humanWithMedia(block)], false);

    const image = userContentBlocks(messages).find(
      (b) => (b as { type?: string }).type === 'image',
    ) as
      | {
          source: { type: string; media_type?: string; data?: string };
        }
      | undefined;
    expect(image).toBeDefined();
    expect(image!.source.type).toBe('base64');
    expect(image!.source.media_type).toBe('image/png');
    expect(image!.source.data).toBe(block.data);
  });

  it('keeps url-encoded PDF document sources unchanged when supportsUrlImages is false', () => {
    const messages = convert([humanWithMedia(urlPdfBlock())], false);

    const serialized = stringifyAll(messages);
    expect(serialized).toContain('"type":"url"');
    expect(serialized).toContain('https://example.com/doc.pdf');
  });

  it('replaces url images in tool results with the placeholder when supportsUrlImages is false', () => {
    const messages = convert(toolResultWithMedia(urlImageBlock()), false);

    const serialized = stringifyAll(messages);
    expect(serialized).not.toContain('"type":"url"');
    expect(serialized).toContain('[Unsupported image:');
  });

  it('keeps url images in tool results when supportsUrlImages is true', () => {
    const messages = convert(toolResultWithMedia(urlImageBlock()), true);

    const serialized = stringifyAll(messages);
    expect(serialized).toContain('"type":"url"');
    expect(serialized).toContain('https://example.com/photo.jpg');
  });
});

describe('prepareAnthropicRequest url-image guard by base URL (#3693)', () => {
  async function prepare(baseURL: string, contents: IContent[]) {
    const callOpts = createProviderCallOptions({
      providerName: 'anthropic',
      contents,
      resolved: {
        model: 'claude-3-5-sonnet-20241022',
        baseURL,
        authToken: 'test-token',
        telemetry: { providerName: 'anthropic' },
      },
    });
    return prepareAnthropicRequest({
      content: callOpts.contents,
      tools: callOpts.tools,
      options: {
        ...callOpts,
        metadata: callOpts.metadata ?? {},
        resolved: {
          model: 'claude-3-5-sonnet-20241022',
          baseURL,
          authToken: 'test-token',
          telemetry: { providerName: 'anthropic' },
        } as NormalizedGenerateChatOptions['resolved'],
      },
      isOAuth: false,
      placement: 'system-field',
      providerName: 'anthropic',
      config: undefined,
      getMaxTokensForModel: () => 4096,
      unprefixToolName: (name: string) => name,
      providerConfig: undefined,
      logger: new DebugLogger('test:anthropic-url-images'),
      toolsLogger: new DebugLogger('test:anthropic-url-images:tools'),
      cacheLogger: noopLogger,
    });
  }

  it('zai base URL: request body carries no image url source and keeps a visible placeholder', async () => {
    const ctx = await prepare('https://api.z.ai/api/anthropic', [
      humanWithMedia(urlImageBlock(), base64ImageBlock()),
    ]);

    const serialized = JSON.stringify(ctx.requestBody);
    expect(serialized).not.toContain('"type":"url"');
    expect(serialized).toContain('[Unsupported image:');
    // The base64 sibling image still serializes as base64 media.
    expect(serialized).toContain('"type":"base64"');
  });

  it('native Anthropic base URL: url source is serialized exactly as before', async () => {
    const ctx = await prepare('https://api.anthropic.com', [
      humanWithMedia(urlImageBlock()),
    ]);

    const serialized = JSON.stringify(ctx.requestBody);
    expect(serialized).toContain('"type":"url"');
    expect(serialized).toContain('https://example.com/photo.jpg');
    expect(serialized).not.toContain('[Unsupported image:');
  });

  it('other third-party base URL: url source is serialized (no behavior change)', async () => {
    const ctx = await prepare('https://my-proxy.example.com/anthropic', [
      humanWithMedia(urlImageBlock()),
    ]);

    expect(JSON.stringify(ctx.requestBody)).toContain('"type":"url"');
  });
});
