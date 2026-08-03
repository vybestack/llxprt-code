/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
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
    const anthropic = await estimateRequestTokens(
      withImage(),
      'anthropic',
      'claude-sonnet-4-20250514',
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

    expect(anthropic.tokens).not.toBe(openai.tokens);
    expect(anthropic.tokens).not.toBe(unknown.tokens);
  });
});
