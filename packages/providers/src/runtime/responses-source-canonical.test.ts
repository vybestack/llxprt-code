/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';

async function* empty(): AsyncIterable<IContent> {}
const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: (): void => {},
};

async function parity(tools: unknown): Promise<string[]> {
  const old: unknown = projectOpenAIResponsesPromptEnvelope({
    model: 'gpt-5.6',
    input: [],
    instructions: '',
    tools,
  }).finalizedProjection;
  if (
    typeof old !== 'object' ||
    old === null ||
    !('promptSegments' in old) ||
    !Array.isArray(old.promptSegments)
  )
    throw new Error('Invalid old oracle');
  const prompt = await serializeResponsesPromptEnvelope({
    model: 'gpt-5.6',
    context,
    instructions: '',
    tools,
    contents: empty(),
  });
  try {
    const actual = prompt.projection.promptSegments.map((segment) =>
      readFileSync(segment.source.path, segment.source.encoding ?? 'utf8'),
    );
    expect(actual).toStrictEqual(old.promptSegments);
    return actual;
  } finally {
    await prompt.dispose();
  }
}

describe('Responses source recursive canonicalization', () => {
  it('preserves numeric key order, sparse arrays, undefined and binary object replacement', async () => {
    const tools = [
      {
        z: undefined,
        '10': 'ten',
        '2': 'two',
        nested: [
          null,
          undefined,
          Infinity,
          -0,
          { type: 'base64', media_type: 'IMAGE/PNG', data: undefined },
        ],
        pdf: {
          type: 'base64',
          media_type: 'application/pdf',
          data: 'JVBERg==',
        },
        unknown: { type: 'base64', media_type: 'audio/wav', data: 5 },
      },
    ];
    expect((await parity(tools)).length).toBe(3);
  });
  it('matches parameterized and repeated data URIs, empty payloads and non-image binaries', async () => {
    const tools = [
      {
        text: 'data:IMAGE/PNG;charset=utf-8;base64,YQ== | DATA:;BASE64,Yg== | data:application/pdf;base64,YQ== | data:image/png;base64, | data:image/png;base64,YQ==',
        duplicate: ['data:image/png;base64,YQ==', 'data:image/png;base64,YQ=='],
      },
    ];
    expect((await parity(tools)).length).toBe(3);
  });
  it('preserves raw string prompt segments including lone UTF-16 surrogates', async () => {
    expect(
      (await parity('a\ud800 \udc00 😀 data:application/pdf;base64,YQ=='))
        .length,
    ).toBe(3);
  });
  it('rejects unsupported bigint JSON without leaving an owner or partial segment', async () => {
    const before = new Set(readdirSync(tmpdir()));
    await expect(
      serializeResponsesPromptEnvelope({
        model: 'gpt-5.6',
        context,
        contents: empty(),
        tools: [{ size: BigInt(1) }],
      }),
    ).rejects.toThrow('BigInt');
    const leaked = readdirSync(tmpdir()).filter((name) => !before.has(name));
    expect(leaked).toStrictEqual([]);
  });
  it('transfers disk image costs without rebuilding an image list', async () => {
    const prompt = await serializeResponsesPromptEnvelope({
      model: 'gpt-5.6',
      context,
      contents: empty(),
      tools: [{ image: 'data:image/png;base64,YQ==' }],
    });
    try {
      const lease = prompt.toEstimatorProjection().acquire();
      try {
        expect(
          await lease.countImageTokens({
            provider: 'openai-responses',
            model: 'gpt-5.6',
          }),
        ).toBe(1844);
      } finally {
        await lease();
      }
    } finally {
      await prompt.dispose();
    }
  });
});
