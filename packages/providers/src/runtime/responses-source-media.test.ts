/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { closeSync, openSync, readSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildOpenAIResponsesInput } from '../openai-responses/OpenAIResponsesInputBuilder.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
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
function hash(path: string): string {
  const fd = openSync(path, 'r');
  const bytes = Buffer.alloc(65536);
  const sha = createHash('sha256');
  try {
    for (;;) {
      const count = readSync(fd, bytes, 0, bytes.length, null);
      if (count === 0) break;
      sha.update(bytes.subarray(0, count));
    }
    return sha.digest('hex');
  } finally {
    closeSync(fd);
  }
}

describe('Responses disk media accounting', () => {
  it('writes thousands of image costs on disk without a request-wide image list', async () => {
    const count = 4096;
    const expected = oracle(count);
    async function* contents(): AsyncIterable<IContent> {
      for (let index = 0; index < count; index++) yield row(index);
    }
    const prompt = await serializeResponsesPromptEnvelope({
      model: 'gpt-5.6',
      context,
      contents: contents(),
    });
    try {
      expect(hash(prompt.projection.promptSegments[0].source.path)).toBe(
        expected,
      );
      expect(prompt.imageCount).toBe(count);
      const lines = readFileSync(prompt.imageCostsSource.path, 'utf8')
        .trim()
        .split('\n');
      expect(lines).toHaveLength(count);
      expect(new Set(lines).size).toBe(1);
      expect(
        Object.getOwnPropertyDescriptor(prompt.projection, 'imageEntries'),
      ).toBeUndefined();
      const lease = prompt.toEstimatorProjection().acquire();
      try {
        expect(
          await lease.countImageTokens({
            provider: 'openai-responses',
            model: 'gpt-5.6',
          }),
        ).toBe(count * 1844);
      } finally {
        await lease();
      }
    } finally {
      await prompt.dispose();
    }
  });
});
