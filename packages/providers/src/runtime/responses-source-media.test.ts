/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildOpenAIResponsesInput } from '../openai-responses/OpenAIResponsesInputBuilder.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';
import {
  nativePrompt,
  nativeRows,
  nativePromptKeys,
  nativeImages,
} from './__tests__/native-responses-fixture.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimits: parseOutputLimits({}),
  debug: (): void => {},
};
function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `image ${index}` },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'YQ==',
      },
    ],
  };
}
function oracle(count: number): string {
  const rows = Array.from({ length: count }, (_, index) => row(index));
  const old: unknown = projectOpenAIResponsesPromptEnvelope({
    model: 'gpt-5.6',
    input: buildOpenAIResponsesInput(rows, context),
  }).finalizedProjection;
  if (
    typeof old !== 'object' ||
    old === null ||
    !('promptSegments' in old) ||
    !Array.isArray(old.promptSegments)
  )
    throw new Error('Invalid old oracle');
  const segment: unknown = old.promptSegments[0];
  if (typeof segment !== 'string') throw new Error('Invalid oracle segment');
  return createHash('sha256').update(segment).digest('hex');
}
describe('Responses disk media accounting', () => {
  it('preserves thousands of native image costs without retaining an image list on the estimator', async () => {
    const count = 4096;
    const expected = oracle(count);
    const prompt = await nativePrompt(
      nativeRows(Array.from({ length: count }, (_, index) => row(index))),
      { model: 'gpt-5.6', context },
    );
    try {
      expect(
        createHash('sha256')
          .update((await nativePromptKeys(prompt))[0])
          .digest('hex'),
      ).toBe(expected);
      const images = await nativeImages(prompt);
      expect(images.length).toBe(count);
      const costs = images.map((entry) =>
        estimateImageTokens({
          provider: 'openai-responses',
          model: 'gpt-5.6',
          dimensions: entry.dimensions,
        }),
      );
      expect(costs).toHaveLength(count);
      expect(new Set(costs).size).toBe(1);
      expect(
        Object.getOwnPropertyDescriptor(
          prompt.toEstimatorProjection(),
          'imageEntries',
        ),
      ).toBeUndefined();
      expect(costs.reduce((sum, value) => sum + value, 0)).toBe(count * 1844);
    } finally {
      await prompt.dispose();
    }
  });
});
