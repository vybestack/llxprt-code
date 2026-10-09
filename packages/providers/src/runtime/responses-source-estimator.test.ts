/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { buildOpenAIResponsesInput } from '../openai-responses/OpenAIResponsesInputBuilder.js';
import { estimateGpt56Prompt } from '../tokenizers/Gpt56O200kPromptEstimator.js';
import { estimateGpt56PromptFromSources } from '../tokenizers/gpt56-source-prompt-estimator.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: (): void => {},
};
const instructions = 'Independent 雪 \\ " \ud800';
const tools = [{ name: 'inspect', parameters: { path: '雪' } }];
const mediaTools = [
  {
    name: 'inspect',
    parameters: {
      image: { type: 'base64', media_type: 'image/png', data: 'YQ==' },
    },
  },
];

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}
function image(
  data: string,
  encoding: 'base64' | 'url' = 'base64',
): MediaBlock {
  return { type: 'media', mimeType: 'image/png', encoding, data };
}
function row(index: number, media: readonly MediaBlock[]): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `image ${index} 雪 " \\` }, ...media],
  };
}
async function* source(rows: readonly IContent[]): AsyncIterable<IContent> {
  yield* rows;
}
function request(
  finalizedProjection: unknown,
  activeProvider = 'openai-responses',
): RuntimePromptEstimateRequest {
  return {
    activeProvider,
    canonicalModel: 'gpt-5.6-sol',
    protocol: 'openai-responses',
    wireMethod: 'responses/v1',
    finalizedProjection,
    projectionRevision: 4,
    legacyEstimate: () => Promise.reject(new Error('No fallback')),
  };
}
function strings(value: unknown): readonly string[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('promptSegments' in value)
  )
    throw new Error('Invalid independent projection');
  if (
    !Array.isArray(value.promptSegments) ||
    !value.promptSegments.every((s: unknown) => typeof s === 'string')
  )
    throw new Error('Invalid independent segments');
  return value.promptSegments;
}
function recordEvidence(
  result: unknown,
  actual: readonly Buffer[],
  expected: readonly Buffer[],
): void {
  const evidence = process.env.ISSUE854_SERIALIZER_EVIDENCE;
  if (evidence === undefined) return;
  const segments = actual.map((bytes, i) => ({
    bytes: bytes.length,
    actualSha256: createHash('sha256').update(bytes).digest('hex'),
    expectedSha256: createHash('sha256').update(expected[i]).digest('hex'),
  }));
  appendFileSync(
    join(evidence, 'image-oracle.jsonl'),
    `${JSON.stringify({ result, segments })}\n`,
  );
}

async function parity(
  rows: readonly IContent[],
  activeProvider = 'openai-responses',
  crossKeyMedia = false,
): Promise<number> {
  const promptKeys = {
    instructions: crossKeyMedia
      ? instructions + ' data:image/png;base64,YQ=='
      : instructions,
    tools: crossKeyMedia ? mediaTools : tools,
  };
  const root = mkdtempSync(join(tmpdir(), 'media-parity-'));
  const workspaceDirectory = join(root, 'scratch');
  mkdirSync(workspaceDirectory);
  const old = projectOpenAIResponsesPromptEnvelope({
    model: 'gpt-5.6-sol',
    ...promptKeys,
    input: buildOpenAIResponsesInput([...rows], context),
  });
  const expected = await estimateGpt56Prompt(
    request(old.finalizedProjection, activeProvider),
  );
  const prompt = await serializeResponsesPromptEnvelope({
    model: 'gpt-5.6-sol',
    ...promptKeys,
    context,
    contents: source(rows),
  });
  try {
    const actualBytes = prompt.projection.promptSegments.map((s) =>
      readFileSync(s.source.path),
    );
    const expectedBytes = strings(old.finalizedProjection).map((s, i) =>
      Buffer.from(s, i === 0 ? 'utf16le' : 'utf8'),
    );
    expect(actualBytes).toStrictEqual(expectedBytes);
    const owner = prompt.toEstimatorProjection();
    const pending = estimateGpt56PromptFromSources(
      request(owner, activeProvider),
      { workspaceDirectory },
    );
    const closing = prompt.dispose();
    const actual = await pending;
    await closing;
    expect(actual).toStrictEqual(expected);
    recordEvidence(
      {
        rows: rows.length,
        activeProvider,
        crossKeyMedia,
        imageCount: prompt.imageCount,
        actual,
        expected,
      },
      actualBytes,
      expectedBytes,
    );
    expect(
      Object.getOwnPropertyDescriptor(owner, 'imageEntries'),
    ).toBeUndefined();
    expect(readdirSync(workspaceDirectory)).toStrictEqual([]);
    return actual.count;
  } finally {
    await prompt.dispose();
    expect(existsSync(prompt.imageCostsSource.path)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  }
}

describe('Responses serializer to opt-in GPT56 image estimator', () => {
  it('preserves bytes and independent string estimate for one parsed PNG', async () => {
    expect(await parity([row(0, [image(png(32, 32))])])).toBeGreaterThan(0);
  });
  it('preserves multiple dimensions, patch cap, unknown dimensions and URL behavior', async () => {
    expect(
      await parity([
        row(0, [
          image(png(31, 33)),
          image(png(1586, 991)),
          image(png(4096, 4096)),
          image('YQ=='),
          image('https://example.test/image.png', 'url'),
        ]),
      ]),
    ).toBeGreaterThan(0);
  });
  it('preserves 64 images across 64 distinct rows as one full-key text count', async () => {
    expect(
      await parity(
        Array.from({ length: 64 }, (_, i) => row(i, [image(png(32 + i, 33))])),
      ),
    ).toBeGreaterThan(0);
  }, 180000);
  it('preserves independent bytes and string-oracle tokens for 4096 images', async () => {
    expect(
      await parity(
        Array.from({ length: 4096 }, (_, i) =>
          row(i, [image(i % 2 === 0 ? png(31, 33) : 'YQ==')]),
        ),
      ),
    ).toBeGreaterThan(0);
  }, 600000);
  it.each(['codex-alias', 'custom-provider', 'anthropic-alias'])(
    'uses unchanged image estimation semantics for %s rather than stale persisted costs',
    async (provider) => {
      expect(
        await parity([row(0, [image(png(32, 32)), image('YQ==')])], provider),
      ).toBeGreaterThan(0);
    },
  );
});

describe('Responses large-row source admission', () => {
  it('accepts a valid greater-than-10MiB text row into the estimator without native long-input claims', async () => {
    const size = 10 * 1024 * 1024 + 1;
    const prompt = await serializeResponsesPromptEnvelope({
      model: 'gpt-5.6-sol',
      context,
      contents: source([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'a'.repeat(size) }],
        },
      ]),
    });
    try {
      expect(
        statSync(prompt.projection.promptSegments[0].source.path).size,
      ).toBeGreaterThan(10 * 1024 * 1024);
      const projection = prompt.toEstimatorProjection();
      expect(projection.promptSegments).toHaveLength(1);
      const lease = projection.acquire();
      try {
        expect(
          await lease.countImageTokens({
            provider: 'openai',
            model: 'gpt-5.6',
          }),
        ).toBe(0);
      } finally {
        await lease();
      }
    } finally {
      await prompt.dispose();
    }
  }, 180000);
});

describe('Responses disk unsupported-media enforcement', () => {
  it('counts instruction and tool images alongside input images under the same lease', async () => {
    expect(
      await parity([row(0, [image(png(32, 32))])], 'openai-responses', true),
    ).toBeGreaterThan(0);
  });
  it('preserves supported PDF text bytes and tokens without bypassing disabled PDF rejection', async () => {
    expect(
      await parity([
        row(0, [
          {
            type: 'media',
            mimeType: 'application/pdf',
            encoding: 'base64',
            data: 'JVBERg==',
            filename: 'sample.pdf',
          },
        ]),
      ]),
    ).toBeGreaterThan(0);
  });
  it.each(['audio/wav', 'application/pdf'])(
    'rejects unsupported %s conversion instead of dropping the disk metadata',
    async (mimeType) => {
      const prompt = await serializeResponsesPromptEnvelope({
        model: 'gpt-5.6-sol',
        context: { ...context, mediaPdfEnabled: false },
        contents: source([
          row(0, [
            { type: 'media', mimeType, encoding: 'base64', data: 'JVBERg==' },
          ]),
        ]),
      });
      try {
        expect(
          readFileSync(prompt.unsupportedMediaSource.path, 'utf8'),
        ).toContain('unsupported');
        expect(() => prompt.toEstimatorProjection()).toThrow(
          'unsupported media',
        );
      } finally {
        await prompt.dispose();
      }
    },
  );
});
