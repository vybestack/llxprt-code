/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the Anthropic prompt-envelope projection (issue #2817).
 *
 * The provider builds a finalized request body in its preparation path. The
 * projection counts tokens against ONLY the prompt-bearing typed fields
 * (system/messages/tools) — never the full HTTP body, which would inflate
 * counts with transport controls (stream, max_tokens, tool_choice) and raw
 * base64 media.
 *
 * Cross-provider contracts (consistency, fail-fast, immutability) live in
 * promptEnvelopeProjections.test.ts; OpenAI projections in
 * promptEnvelopeProjections.openai.test.ts.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A3, A4, A5, A9, finding #6)
 */

import { describe, it, expect } from 'bun:test';
import { parseImageDimensionsFromBase64 } from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';
import {
  projectAnthropicPromptEnvelope,
  PROJECTION_REVISION,
  type ProviderFinalizedPromptProjection,
} from './promptEnvelopeProjections.js';

/**
 * Handcrafted minimal PNG whose IHDR declares 1586x991.
 *
 * 8-byte signature, then an IHDR chunk: length 13, 'IHDR', width/height as
 * big-endian uint32, bit depth 8, color type 6 (RGBA), compression/filter/interlace
 * zero, then a zeroed CRC. parseImageDimensionsFromBase64 reads only the
 * header, so the missing IDAT is irrelevant.
 */
function handcraftedPngBase64(width: number, height: number): string {
  // prettier-ignore
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff, (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff, 8, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function finalizedEntries(
  projection: ProviderFinalizedPromptProjection,
): ReadonlyArray<{ dimensions?: { width: number; height: number } }> {
  return projection.imageEntries ?? [];
}

describe('projectAnthropicPromptEnvelope (issue #2817)', () => {
  it('identifies anthropic-messages protocol, messages/v1 method, and model from the finalized request body', () => {
    const requestBody = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const projection = projectAnthropicPromptEnvelope(requestBody);
    expect(projection.protocol).toBe('anthropic-messages');
    expect(projection.method).toBe('messages/v1');
    expect(projection.model).toBe('claude-3-5-sonnet-20241022');
    expect(projection.projectionRevision).toBe(PROJECTION_REVISION);
    expect(projection.projectionRevision).toBe(4);
    // Assert immutability before toMatchObject: Bun's expect mutates the
    // received object's properties when resolving asymmetric matchers, which
    // would otherwise unfreeze finalizedProjection before this check runs.
    expect(Object.isFrozen(projection.finalizedProjection)).toBe(true);
    expect(projection.finalizedProjection).toMatchObject({
      kind: 'llxprt-provider-prompt-v3',
      protocol: 'anthropic-messages',
      promptText: expect.any(String),
    });
  });

  it('counts more tokens for a larger prompt (messages+system+tools), not the full HTTP body', async () => {
    const small = {
      model: 'claude-3-5-sonnet',
      max_tokens: 100,
      stream: true,
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const large = {
      model: 'claude-3-5-sonnet',
      max_tokens: 100,
      stream: true,
      messages: [
        {
          role: 'user',
          content:
            'Please write a very long detailed essay about the history of computing.',
        },
      ],
    };

    const smallTokens =
      await projectAnthropicPromptEnvelope(small).legacyEstimate();
    const largeTokens =
      await projectAnthropicPromptEnvelope(large).legacyEstimate();
    expect(largeTokens).toBeGreaterThan(smallTokens);
  });

  it('does NOT count transport controls (stream, max_tokens, tool_choice) — only system/messages/tools', async () => {
    const promptOnly = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello world' }],
      system: 'Be helpful.',
    };

    const withTransportControls = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello world' }],
      system: 'Be helpful.',
      stream: true,
      max_tokens: 8192,
      tool_choice: { type: 'auto' },
      metadata: { user_id: 'abc123' },
    };

    const a = await projectAnthropicPromptEnvelope(promptOnly).legacyEstimate();
    const b = await projectAnthropicPromptEnvelope(
      withTransportControls,
    ).legacyEstimate();
    // Adding transport controls must NOT change the estimate — only prompt
    // fields are counted.
    expect(b).toBe(a);
  });

  it('counts tools as prompt-bearing material', async () => {
    const withoutTools = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const withTools = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
    };

    const withoutTokens =
      await projectAnthropicPromptEnvelope(withoutTools).legacyEstimate();
    const withTokens =
      await projectAnthropicPromptEnvelope(withTools).legacyEstimate();
    expect(withTokens).toBeGreaterThan(withoutTokens);
  });

  it('does NOT inflate the count with raw base64 image data', async () => {
    const textOnly = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Describe this' }],
    };
    const withBase64Image = {
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'A'.repeat(100_000),
              },
            },
          ],
        },
      ],
    };

    const textTokens =
      await projectAnthropicPromptEnvelope(textOnly).legacyEstimate();
    const imageTokens =
      await projectAnthropicPromptEnvelope(withBase64Image).legacyEstimate();
    // Base64 data should not dominate the count (finding #6: avoid raw base64
    // distortion). The image-bearing message has MORE text fields (the content
    // array wrapper), but the 100k base64 string must not inflate the count
    // proportionally.
    expect(imageTokens).toBeLessThan(textTokens * 50);
  });

  it('counts long prompt-bearing data values that are not marked as base64 media', async () => {
    const build = (size: number) => ({
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [{ type: 'document', data: 'A'.repeat(size) }],
        },
      ],
    });

    const shortTokens = await projectAnthropicPromptEnvelope(
      build(300),
    ).legacyEstimate();
    const longTokens = await projectAnthropicPromptEnvelope(
      build(10_000),
    ).legacyEstimate();

    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  it('keeps binary-size invariant for RFC 2397 data URLs without a media type', async () => {
    const project = (size: number) =>
      projectAnthropicPromptEnvelope({
        model: 'claude-3-5-sonnet',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this' },
              { type: 'image', source: `data:;base64,${'A'.repeat(size)}` },
            ],
          },
        ],
      }).legacyEstimate();

    const baselineTokens = await project(1_000);
    const inflatedTokens = await project(100_000);

    expect(baselineTokens).toBeGreaterThan(0);
    expect(inflatedTokens).toBe(baselineTokens);
  });

  it('keeps binary-size invariant for data URLs with MIME parameters', async () => {
    const project = (size: number) =>
      projectAnthropicPromptEnvelope({
        model: 'claude-3-5-sonnet',
        messages: [
          {
            role: 'user',
            content: `Embedded document: data:text/html;charset=utf-8;base64,${'A'.repeat(size)}`,
          },
        ],
      }).legacyEstimate();

    const baselineTokens = await project(1_000);
    const inflatedTokens = await project(100_000);

    expect(baselineTokens).toBeGreaterThan(0);
    expect(inflatedTokens).toBe(baselineTokens);
  });

  it('scrubs all data URIs when a single string field contains multiple data URLs', async () => {
    const build = (bytes: number) => ({
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: `Look at these two images: data:image/png;base64,${'A'.repeat(bytes)} and data:image/jpeg;base64,${'B'.repeat(bytes)}`,
        },
      ],
    });
    const small = await projectAnthropicPromptEnvelope(
      build(1_000),
    ).legacyEstimate();
    const large = await projectAnthropicPromptEnvelope(
      build(100_000),
    ).legacyEstimate();
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
  });

  it('surfaces unsupported media explicitly when passed from preparation', () => {
    const requestBody = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const unsupported = [
      {
        kind: 'unsupported' as const,
        reason: 'video not supported',
        mediaType: 'video',
      },
    ];
    const projection = projectAnthropicPromptEnvelope(requestBody, {
      unsupportedMedia: unsupported,
    });
    expect(projection.unsupportedMedia).toHaveLength(1);
    expect(projection.unsupportedMedia[0].kind).toBe('unsupported');
  });

  it('records a base64 image source as an image entry with parsed dimensions (issue #3481)', () => {
    const png = handcraftedPngBase64(1586, 991);
    expect(parseImageDimensionsFromBase64(png)).toStrictEqual({
      width: 1586,
      height: 991,
    });

    const projection = projectAnthropicPromptEnvelope({
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: png,
              },
            },
          ],
        },
      ],
    });
    const finalized =
      projection.finalizedProjection as ProviderFinalizedPromptProjection;
    expect(finalizedEntries(finalized)).toStrictEqual([
      { dimensions: { width: 1586, height: 991 } },
    ]);
    expect(finalized.promptText).toContain('[binary media bytes omitted]');
    expect(finalized.promptText).not.toContain(png);
  });

  it('records an image entry for an anthropic base64 source with an uppercase media_type (issue #3481)', () => {
    const png = handcraftedPngBase64(1586, 991);

    const projection = projectAnthropicPromptEnvelope({
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'IMAGE/PNG',
                data: png,
              },
            },
          ],
        },
      ],
    });
    const finalized =
      projection.finalizedProjection as ProviderFinalizedPromptProjection;
    expect(finalizedEntries(finalized)).toStrictEqual([
      { dimensions: { width: 1586, height: 991 } },
    ]);
    expect(finalized.promptText).toContain('[binary media bytes omitted]');
    expect(finalized.promptText).not.toContain(png);
  });

  it('records no image entry for an anthropic PDF document source (issue #3481)', () => {
    const projection = projectAnthropicPromptEnvelope({
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: 'JVBERi0xLjQ=',
              },
            },
          ],
        },
      ],
    });
    const finalized =
      projection.finalizedProjection as ProviderFinalizedPromptProjection;
    expect(finalized.imageEntries).toBeUndefined();
    expect(finalized.promptText).toContain('[binary media bytes omitted]');
  });
});
