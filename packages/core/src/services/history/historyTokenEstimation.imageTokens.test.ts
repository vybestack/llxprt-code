/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'bun:test';
import {
  estimateContentTokens,
  type TokenizerProvider,
} from './historyTokenEstimation.js';
import type { IContent, MediaBlock } from './IContent.js';
import type { RuntimeTokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';
import type { DebugLogger } from '../../debug/index.js';

const noopLogger: DebugLogger = {
  debug: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
} as unknown as DebugLogger;

/**
 * A REAL tokenizer that counts deterministically (length / 4), so assertions
 * exercise genuine arithmetic on the caption text rather than a canned total.
 */
function makeLengthTokenizer(): RuntimeTokenizer {
  return {
    fallbackPolicy: 'allow',
    countTokens: (content: unknown) => Math.ceil(String(content).length / 4),
  };
}

function providerWith(activeProvider?: string): TokenizerProvider {
  return {
    getTokenizerForModel: () => makeLengthTokenizer(),
    activeProvider,
  };
}

function buildPngBase64(width: number, height: number): string {
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

function mediaBlock(
  overrides: Partial<MediaBlock> & { data: string },
): MediaBlock {
  return {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    ...overrides,
  };
}

describe('estimateContentTokens — image media blocks', () => {
  it('adds the anthropic image estimate to the caption tokens for base64 images', async () => {
    const caption = 'a diagram of the system';
    const b64 = buildPngBase64(1092, 1092);
    const content: IContent = {
      speaker: 'human',
      blocks: [mediaBlock({ data: b64, caption })],
    };
    // 1092x1092 costs 1590 tokens on Anthropic (published reference value).
    const expected = Math.ceil(caption.length / 4) + 1590;

    const total = await estimateContentTokens(
      content,
      'claude-sonnet',
      providerWith('anthropic'),
      noopLogger,
    );

    expect(total).toBe(expected);
    expect(total).toBeGreaterThan(Math.ceil(caption.length / 4));
  });

  it('produces different totals for openai vs gemini for the same image', async () => {
    const b64 = buildPngBase64(1024, 1024);
    const content: IContent = {
      speaker: 'human',
      blocks: [mediaBlock({ data: b64 })],
    };

    const openaiTotal = await estimateContentTokens(
      content,
      'gpt-4o',
      providerWith('openai'),
      noopLogger,
    );
    const flatFamilyTotal = await estimateContentTokens(
      content,
      'gemini-2.5-pro',
      providerWith('gemini'),
      noopLogger,
    );

    // 1024x1024 high detail: 2x2 tiles * 170 + 85 base.
    expect(openaiTotal).toBe(765);
    // The flat family charges a fixed estimate regardless of dimensions.
    expect(flatFamilyTotal).toBe(3000);
  });

  it('uses the unknown-dimension constant for url-encoded image media', async () => {
    const content: IContent = {
      speaker: 'human',
      blocks: [
        mediaBlock({
          data: 'https://example.com/image.png',
          encoding: 'url',
          mimeType: 'image/png',
        }),
      ],
    };

    const total = await estimateContentTokens(
      content,
      'claude-sonnet',
      providerWith('anthropic'),
      noopLogger,
    );

    expect(total).toBe(1590);
  });

  it('keeps caption-only behaviour for non-image media (audio)', async () => {
    const caption = 'voice memo transcript';
    const content: IContent = {
      speaker: 'human',
      blocks: [
        mediaBlock({
          data: 'aGVsbG8=',
          mimeType: 'audio/mpeg',
          caption,
        }),
      ],
    };
    const expected = Math.ceil(caption.length / 4);

    const total = await estimateContentTokens(
      content,
      'claude-sonnet',
      providerWith('anthropic'),
      noopLogger,
    );

    expect(total).toBe(expected);
  });

  it('adds text tokens and image tokens together for mixed content', async () => {
    const text = 'look at this photo of a cat';
    const caption = 'a fluffy cat';
    const b64 = buildPngBase64(200, 200);
    const content: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text }, mediaBlock({ data: b64, caption })],
    };
    const textTokens =
      Math.ceil(text.length / 4) + Math.ceil(caption.length / 4);
    // 200x200 on Anthropic: ceil(200 * 200 / 750) = 54 (published reference).
    const imageTokens = 54;

    const total = await estimateContentTokens(
      content,
      'claude-sonnet',
      providerWith('anthropic'),
      noopLogger,
    );

    expect(total).toBe(textTokens + imageTokens);
  });

  it('defaults to the 1000 default family when provider is unknown/absent', async () => {
    const b64 = buildPngBase64(1024, 1024);
    const content: IContent = {
      speaker: 'human',
      blocks: [mediaBlock({ data: b64 })],
    };

    const total = await estimateContentTokens(
      content,
      'stepfun-37',
      providerWith('stepfun'),
      noopLogger,
    );

    expect(total).toBe(1000);

    const totalNoProvider = await estimateContentTokens(
      content,
      'stepfun-37',
      providerWith(undefined),
      noopLogger,
    );
    expect(totalNoProvider).toBe(1000);
  });

  it('counts an image with no caption as the image estimate only', async () => {
    const b64 = buildPngBase64(1024, 1024);
    const content: IContent = {
      speaker: 'human',
      blocks: [mediaBlock({ data: b64 })],
    };
    // 1024x1024 costs 765 tokens on OpenAI high detail (published reference).
    const expected = 765;

    const total = await estimateContentTokens(
      content,
      'gpt-4o',
      providerWith('openai'),
      noopLogger,
    );

    expect(total).toBe(expected);
  });
});
