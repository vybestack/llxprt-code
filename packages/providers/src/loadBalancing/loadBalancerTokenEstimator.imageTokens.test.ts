/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { estimateRequestTokens } from './loadBalancerTokenEstimator.js';

function pngBase64(width: number, height: number): string {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf.toString('base64');
}

function textOnly(): IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'describe this' }] },
  ];
}

function withImage(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'describe this' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: pngBase64(1092, 1092),
        },
      ],
    },
  ];
}

function withReference(
  mimeType: string,
  normalizedBase64Length: number,
  dimensions?: { readonly width: number; readonly height: number },
): IContent[] {
  const contentId =
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const byteLength = Math.floor((normalizedBase64Length * 3) / 4);
  const object = {
    contentId,
    mimeType,
    byteLength,
    normalizedBase64Length,
    ...(dimensions === undefined ? {} : { dimensions }),
  };
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'describe this' },
        {
          type: 'media',
          mimeType,
          encoding: 'reference',
          contentId,
          originalContentId: contentId,
          selectedContentId: contentId,
          originalObject: object,
          selectedObject: object,
          transformation: {
            policyId: 'identity',
            policyVersion: 1,
            parameters: {},
          },
          byteLength,
          normalizedBase64Length,
          semanticMetadata: {},
          ...(dimensions === undefined ? {} : { dimensions }),
        },
      ],
    },
  ];
}

describe('estimateRequestTokens image accounting', () => {
  it('charges the selected provider formula for an image', async () => {
    const baseline = await estimateRequestTokens(
      textOnly(),
      'anthropic',
      'claude-sonnet-4-20250514',
      {},
    );
    const withMedia = await estimateRequestTokens(
      withImage(),
      'anthropic',
      'claude-sonnet-4-20250514',
      {},
    );

    // A 1092x1092 image costs 1590 tokens on Anthropic.
    expect(withMedia.tokens - baseline.tokens).toBe(1590);
  });

  it('varies the image charge with the selected provider', async () => {
    const baseline = await estimateRequestTokens(
      textOnly(),
      'openai',
      'gpt-4o',
      {},
    );
    const openai = await estimateRequestTokens(
      withImage(),
      'openai',
      'gpt-4o',
      {},
    );
    const unknown = await estimateRequestTokens(
      withImage(),
      'stepfun',
      'step-3.7-flash',
      {},
    );

    // 1092x1092 normalises to 768x768 = 4 tiles -> 170*4 + 85.
    expect(openai.tokens - baseline.tokens).toBe(765);
    // An unrecognised provider falls back to the flat default estimate.
    expect(unknown.tokens - baseline.tokens).toBe(1000);
  });

  it('uses reference dimensions for image cost without reading media bytes', async () => {
    const baseline = await estimateRequestTokens(
      textOnly(),
      'anthropic',
      'claude-sonnet-4-20250514',
      {},
    );
    const referenced = await estimateRequestTokens(
      withReference('image/png', 16_000, { width: 1092, height: 1092 }),
      'anthropic',
      'claude-sonnet-4-20250514',
      {},
    );

    expect(referenced.tokens - baseline.tokens).toBe(1590);
  });

  it('retains normalized encoded-size charge for an image reference without usable dimensions', async () => {
    const baseline = await estimateRequestTokens(
      textOnly(),
      'anthropic',
      'claude-sonnet-4-20250514',
      {},
    );
    const referenced = await estimateRequestTokens(
      withReference('image/png', 16_000),
      'anthropic',
      'claude-sonnet-4-20250514',
      {},
    );

    expect(referenced.tokens - baseline.tokens).toBeGreaterThan(1590);
    expect(referenced.source).toContain('generic');
  });

  it('retains normalized encoded-size charge for non-image references with dimensions', async () => {
    const small = await estimateRequestTokens(
      withReference('application/pdf', 12, { width: 612, height: 792 }),
      'stepfun',
      'step-3.7-flash',
      {},
    );
    const large = await estimateRequestTokens(
      withReference('application/pdf', 9_000, { width: 612, height: 792 }),
      'stepfun',
      'step-3.7-flash',
      {},
    );

    expect(large.tokens).toBeGreaterThan(small.tokens);
  });

  it('uses normalized encoded length when reference dimensions do not define a media charge', async () => {
    const small = await estimateRequestTokens(
      withReference('application/pdf', 12),
      'stepfun',
      'step-3.7-flash',
      {},
    );
    const large = await estimateRequestTokens(
      withReference('application/pdf', 9_000),
      'stepfun',
      'step-3.7-flash',
      {},
    );

    expect(large.tokens).toBeGreaterThan(small.tokens);
  });
});
