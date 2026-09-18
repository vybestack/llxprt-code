/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectUnsupportedMedia } from '../utils/mediaUtils.js';
import {
  createMediaSupportPredicate,
  isAnthropicOAuthBaseURL,
  isZaiAnthropicEndpoint,
} from './AnthropicEndpointUtils.js';

describe('isZaiAnthropicEndpoint (#3693)', () => {
  it.each([
    ['https://api.z.ai/api/anthropic', true],
    ['https://z.ai/api/anthropic', true],
    ['https://open.bigmodel.cn/api/anthropic', true],
    ['https://bigmodel.cn/api/anthropic', true],
    ['https://API.Z.AI/api/anthropic', true],
    ['https://api.z.ai./api/anthropic', true],
    ['https://open.bigmodel.cn./api/paas/v4', true],
    ['https://api.anthropic.com', false],
    ['https://api.anthropic.com./', false],
    ['https://anthropic.com', false],
    ['https://api.openai.com/v1', false],
    ['https://z.ai.example.com/api', false],
    ['https://notz.ai.example.com/api', false],
    ['https://evilbigmodel.cn.attacker.com', false],
  ])('classifies %s as zai=%s', (baseURL, expected) => {
    expect(isZaiAnthropicEndpoint(baseURL)).toBe(expected);
  });

  it('returns false for undefined and empty base URLs (default is native Anthropic)', () => {
    expect(isZaiAnthropicEndpoint(undefined)).toBe(false);
    expect(isZaiAnthropicEndpoint('')).toBe(false);
    expect(isZaiAnthropicEndpoint('   ')).toBe(false);
  });

  it('returns false for malformed URLs without throwing', () => {
    expect(isZaiAnthropicEndpoint('not a url')).toBe(false);
    expect(isZaiAnthropicEndpoint('http://')).toBe(false);
  });

  it('agrees with the OAuth test on native and third-party endpoints', () => {
    // Native endpoint: OAuth-eligible (native) and not zai.
    expect(isAnthropicOAuthBaseURL('https://api.anthropic.com')).toBe(true);
    expect(isZaiAnthropicEndpoint('https://api.anthropic.com')).toBe(false);
    // zai endpoint: not OAuth-eligible and zai.
    expect(isAnthropicOAuthBaseURL('https://api.z.ai/api/anthropic')).toBe(
      false,
    );
    expect(isZaiAnthropicEndpoint('https://api.z.ai/api/anthropic')).toBe(true);
  });
});

describe('createMediaSupportPredicate projection (#3693)', () => {
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

  function pdfBlock(): MediaBlock {
    return {
      type: 'media',
      mimeType: 'application/pdf',
      data: 'https://example.com/doc.pdf',
      encoding: 'url' as const,
    };
  }

  function audioBlock(): MediaBlock {
    return {
      type: 'media',
      mimeType: 'audio/wav',
      data: 'UklGRiQAAAABAAgASFRT',
      encoding: 'base64' as const,
    };
  }

  function humanWithMedia(...media: MediaBlock[]): IContent {
    return {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'look at this' }, ...media],
    };
  }

  function collectFor(
    baseURL: string | undefined,
    contents: readonly IContent[],
  ) {
    return collectUnsupportedMedia(
      contents,
      createMediaSupportPredicate(baseURL),
    );
  }

  it('zai base URL: lists the url image, keeps the base64 image and pdf supported, and lists audio', () => {
    const entries = collectFor('https://api.z.ai/api/anthropic', [
      humanWithMedia(
        urlImageBlock(),
        base64ImageBlock(),
        pdfBlock(),
        audioBlock(),
      ),
    ]);

    // Exactly one image entry out of the two image blocks: the url-encoded one.
    expect(entries.filter((entry) => entry.mediaType === 'image')).toHaveLength(
      1,
    );
    expect(entries.filter((entry) => entry.mediaType === 'pdf')).toHaveLength(
      0,
    );
    expect(entries.filter((entry) => entry.mediaType === 'audio')).toHaveLength(
      1,
    );
  });

  it('zai base URL: a lone base64 image projects no unsupported entries', () => {
    const entries = collectFor('https://api.z.ai/api/anthropic', [
      humanWithMedia(base64ImageBlock()),
    ]);

    expect(entries).toHaveLength(0);
  });

  it('zai base URL: a lone url image projects exactly one image entry', () => {
    const entries = collectFor('https://api.z.ai/api/anthropic', [
      humanWithMedia(urlImageBlock()),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].mediaType).toBe('image');
  });

  it.each([
    ['native', 'https://api.anthropic.com'],
    ['undefined', undefined],
  ])(
    '%s base URL: the url image is not listed (audio still is)',
    (_label, baseURL) => {
      const entries = collectFor(baseURL, [
        humanWithMedia(
          urlImageBlock(),
          base64ImageBlock(),
          pdfBlock(),
          audioBlock(),
        ),
      ]);

      expect(
        entries.filter((entry) => entry.mediaType === 'image'),
      ).toHaveLength(0);
      expect(entries.filter((entry) => entry.mediaType === 'pdf')).toHaveLength(
        0,
      );
      expect(
        entries.filter((entry) => entry.mediaType === 'audio'),
      ).toHaveLength(1);
    },
  );
});
