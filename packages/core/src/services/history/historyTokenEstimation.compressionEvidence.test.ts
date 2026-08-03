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
import { HistoryService } from './HistoryService.js';
import type { IContent, MediaBlock } from './IContent.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { parseImageDimensionsFromBase64 } from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';

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

function imageContent(): IContent {
  const b64 = buildPngBase64(1092, 1092);
  const block: MediaBlock = {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: b64,
  };
  return { speaker: 'human', blocks: [block] };
}

describe('HistoryService.estimateTokensForContents — image token evidence', () => {
  it('returns materially more tokens for history containing an image', async () => {
    const svc = new HistoryService();
    svc.setActiveTokenizationTarget('claude-sonnet-4-20250514', 'anthropic');

    const withImage = [imageContent()];
    const withoutImage: IContent[] = [];

    const tokensWith = await svc.estimateTokensForContents(withImage);
    const tokensWithout = await svc.estimateTokensForContents(withoutImage);

    expect(tokensWith).toBeGreaterThan(tokensWithout);
  });

  it('the delta matches the estimator for the configured provider', async () => {
    const svc = new HistoryService();
    svc.setActiveTokenizationTarget('claude-sonnet-4-20250514', 'anthropic');

    const content = [imageContent()];
    // The 1092x1092 PNG costs 1590 tokens on Anthropic (published reference).
    const expectedImageTokens = 1590;

    const tokensWith = await svc.estimateTokensForContents(content);
    const tokensWithout = await svc.estimateTokensForContents([]);

    expect(tokensWith - tokensWithout).toBe(expectedImageTokens);
  });

  it('varies the image token delta by provider', async () => {
    const content = [imageContent()];
    const b64 = (content[0].blocks[0] as MediaBlock).data;
    const dims = parseImageDimensionsFromBase64(b64);

    const svcAnthropic = new HistoryService();
    svcAnthropic.setActiveTokenizationTarget(
      'claude-sonnet-4-20250514',
      'anthropic',
    );
    const anthropicDelta =
      (await svcAnthropic.estimateTokensForContents(content)) -
      (await svcAnthropic.estimateTokensForContents([]));

    const svcOpenai = new HistoryService();
    svcOpenai.setActiveTokenizationTarget('gpt-4o', 'openai');
    const openaiDelta =
      (await svcOpenai.estimateTokensForContents(content)) -
      (await svcOpenai.estimateTokensForContents([]));

    expect(anthropicDelta).toBe(
      estimateImageTokens({ provider: 'anthropic', dimensions: dims }),
    );
    expect(openaiDelta).toBe(
      estimateImageTokens({ provider: 'openai', dimensions: dims }),
    );
    expect(anthropicDelta).not.toBe(openaiDelta);
  });
});
