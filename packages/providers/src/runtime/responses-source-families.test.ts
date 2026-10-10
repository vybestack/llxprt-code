/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeProjection,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { buildOpenAIResponsesInput } from '../openai-responses/OpenAIResponsesInputBuilder.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: (): void => {},
};
const scratch = mkdtempSync(join(tmpdir(), 'source-families-'));

const factory = createRuntimeTokenizerFactory();
const sourceFactory = withGpt56DiskSources(factory, scratch);
const instructions = 'Be exact. 雪 \\ " \ud800';
const tools = [{ name: 'inspect', parameters: { path: '雪' } }];

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}
const image: MediaBlock = {
  type: 'media',
  mimeType: 'image/png',
  encoding: 'base64',
  data: png(64, 48),
};

const textRows: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'first 雪 " \\ line' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'answer\n\n  indented' }] },
];
const toolRows: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'inspect it' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'hist_tool_1',
        name: 'inspect',
        parameters: { path: '雪', depth: 2 },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'inspect',
        result: { ok: true, entries: ['a', 'b'] },
      },
    ],
  },
];
const mediaRows: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'look' }, image, image] },
];
// Whitespace and newline runs straddle every fixed read window; counting
// 8 KiB chunks independently would tokenize the runs differently.
const boundaryRows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [
      {
        type: 'text',
        text: `${'a'.repeat(8191)}${' '.repeat(300)}\n\n${'b'.repeat(20000)}\r\n${'雪'.repeat(2000)}`,
      },
    ],
  },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'a' }] },
  { speaker: 'human', blocks: [{ type: 'text', text: 'b' }] },
];
const cases: ReadonlyArray<readonly [string, readonly IContent[]]> = [
  ['text', textRows],
  ['tool calls and results', toolRows],
  ['media', mediaRows],
  ['segmentation boundaries', boundaryRows],
];
// o200k disk counter, o200k fallback identity, and an unregistered (legacy) model.
const supportedModels = [
  'gpt-5.6-sol',
  'gpt-6-astra',
  'gpt-5.6-not-a-snapshot',
  'unregistered-model-x',
];

async function* stream(rows: readonly IContent[]): AsyncGenerator<IContent> {
  yield* rows;
}

function keys(): { instructions: string; tools: unknown } {
  return { instructions, tools };
}

/** Independent array-route expectation built from the legacy string projection. */
function legacyEstimate(model: string, rows: readonly IContent[]) {
  const projection = projectOpenAIResponsesPromptEnvelope({
    model,
    ...keys(),
    input: buildOpenAIResponsesInput([...rows], context),
  });
  return estimatePromptEnvelope('openai-responses', projection, factory);
}

async function sourceEstimate(model: string, rows: readonly IContent[]) {
  const prompt = await serializeResponsesPromptEnvelope({
    model,
    ...keys(),
    context,
    contents: stream(rows),
  });
  try {
    const projection: PromptEnvelopeProjection = {
      model: prompt.model,
      protocol: prompt.protocol,
      method: prompt.method,
      projectionRevision: prompt.projectionRevision,
      unsupportedMedia: [],
      transportToken: {},
      finalizedProjection: prompt.toEstimatorProjection(),
      legacyEstimate: () =>
        Promise.reject(new Error('source route must not use the legacy path')),
    };
    return await estimatePromptEnvelope(
      'openai-responses',
      projection,
      sourceFactory,
    );
  } finally {
    await prompt.dispose();
  }
}

describe('source estimation across tokenizer families', () => {
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  for (const model of supportedModels) {
    for (const [name, rows] of cases) {
      it(`${model}: ${name} matches the independent array estimate`, async () => {
        const expected = await legacyEstimate(model, rows);
        const actual = await sourceEstimate(model, rows);
        expect(actual).toStrictEqual(expected);
        expect(actual.estimatedPromptTokens).toBeGreaterThan(0);
      });
    }
  }

  it('selects different families for o200k and legacy models', async () => {
    const o200k = await sourceEstimate('gpt-5.6-sol', textRows);
    const legacy = await sourceEstimate('unregistered-model-x', textRows);
    expect(o200k.estimatorFamily).toBe('openai-gpt-5.6');
    expect(legacy.estimatorFamily).toBe('legacy-unregistered');
  });

  it('fails the same way as the array route for a family that rejects the protocol', async () => {
    const arrayFailure = await legacyEstimate('glm-5.2', textRows).then(
      () => undefined,
      (error: unknown) => error,
    );
    const sourceFailure = await sourceEstimate('glm-5.2', textRows).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(arrayFailure).toBeInstanceOf(Error);
    expect(sourceFailure).toBeInstanceOf(Error);
    expect((sourceFailure as Error).message).toBe(
      (arrayFailure as Error).message,
    );
  });

  it('rejects an empty or blank model before any segment is written', async () => {
    for (const model of ['', '   ']) {
      await expect(sourceEstimate(model, textRows)).rejects.toThrow(
        'Prompt source requires a non-empty model',
      );
      expect(() => legacyEstimate(model, textRows)).toThrow(
        'non-empty string "model"',
      );
    }
  });

  it('returns scalar descriptors, not prompt text', async () => {
    const marker = 'UNIQUE-CONTEXT-MARKER-'.repeat(40);
    const rows: readonly IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: marker }] },
    ];
    for (const model of ['gpt-5.6-sol', 'unregistered-model-x']) {
      const estimate = await sourceEstimate(model, rows);
      expect(JSON.stringify(estimate)).not.toContain('UNIQUE-CONTEXT-MARKER');
      const longStrings = Object.values(estimate).filter(
        (value) => typeof value === 'string' && value.length >= 200,
      );
      expect(longStrings).toStrictEqual([]);
    }
  });
});
