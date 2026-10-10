/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from '../openai-responses/OpenAIResponsesInputBuilder.js';
import {
  serializeResponsesPromptEnvelope,
  type ResponsesSourcePrompt,
} from './responses-source-serializer.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { requestScopedContents } from '../utils/requestScopedBody.js';
import { collectUnsupportedMedia } from '../utils/mediaUtils.js';
import { SyntheticToolResponseHandler } from '../openai/syntheticToolResponses.js';

const context: ResponsesInputBuildContext = {
  includeReasoningInContext: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: () => {},
  mediaPdfEnabled: true,
};
const model = 'gpt-5.6';
const instructions = 'Preserve "quotes", \\ and 雪\n\ud800';
const tools = [
  {
    type: 'function',
    name: 'read',
    parameters: {
      properties: {
        '2': undefined,
        '1': 'first',
        tail: [undefined, NaN, -0, '\udc00'],
      },
    },
  },
];

async function* source(rows: readonly IContent[]): AsyncIterable<IContent> {
  yield* rows;
}

function finalized(value: unknown): FinalizedOracle {
  if (!isFinalizedOracle(value)) throw new Error('Invalid old oracle');
  return value;
}
interface FinalizedOracle {
  readonly promptSegments: readonly string[];
  readonly imageEntries?: ReadonlyArray<{
    readonly dimensions?: { readonly width: number; readonly height: number };
  }>;
}
function isFinalizedOracle(value: unknown): value is FinalizedOracle {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('promptSegments' in value)
  )
    return false;
  return (
    Array.isArray(value.promptSegments) &&
    value.promptSegments.every(
      (segment: unknown) => typeof segment === 'string',
    )
  );
}

function texts(prompt: ResponsesSourcePrompt): string[] {
  return prompt.projection.promptSegments.map((segment) =>
    readFileSync(segment.source.path, segment.source.encoding ?? 'utf8'),
  );
}

async function compare(
  rows: IContent[],
  buildContext = context,
): Promise<number> {
  const unsupportedMedia = collectUnsupportedMedia(
    rows,
    (_block, category) =>
      category === 'image' ||
      (category === 'pdf' && buildContext.mediaPdfEnabled),
  );
  const oracle = projectOpenAIResponsesPromptEnvelope(
    {
      model,
      instructions,
      tools,
      input: buildOpenAIResponsesInput(
        SyntheticToolResponseHandler.patchMessageHistory(rows),
        buildContext,
      ),
    },
    { unsupportedMedia },
  );
  const old = finalized(oracle.finalizedProjection);
  const prompt = await serializeResponsesPromptEnvelope({
    model,
    instructions,
    tools,
    contents: source(rows),
    context: buildContext,
  });
  try {
    expect<readonly string[] | undefined>(texts(prompt)).toStrictEqual(
      old.promptSegments,
    );
    expect(prompt.model).toBe(oracle.model);
    expect(prompt.projectionRevision).toBe(oracle.projectionRevision);
    const costs = readFileSync(prompt.imageCostsSource.path, 'utf8').trim();
    const expected = (old.imageEntries ?? []).map((entry) => ({
      cost: estimateImageTokens({
        provider: 'openai-responses',
        model,
        dimensions: entry.dimensions,
      }),
      ...(entry.dimensions === undefined
        ? {}
        : { dimensions: entry.dimensions }),
    }));
    expect(
      costs === '' ? [] : costs.split('\n').map((line) => JSON.parse(line)),
    ).toStrictEqual(expected);
    expect(prompt.imageCount).toBe(expected.length);
    const unsupported = readFileSync(
      prompt.unsupportedMediaSource.path,
      'utf8',
    ).trim();
    const actualUnsupported: unknown =
      unsupported === ''
        ? []
        : unsupported.split('\n').map((line) => JSON.parse(line));
    expect(actualUnsupported).toStrictEqual(oracle.unsupportedMedia);
    expect(
      Object.getOwnPropertyDescriptor(prompt, 'imageEntries'),
    ).toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(prompt.projection, 'promptText'),
    ).toBeUndefined();
    return Buffer.byteLength(texts(prompt)[1]);
  } finally {
    await prompt.dispose();
  }
}

function richRows(): IContent[] {
  return Array.from({ length: 64 }, (_, index): IContent => {
    const text = `${index}: \\ " 雪  \ud800\n data:application/pdf;base64,YQ== duplicate duplicate`;
    if (index % 3 === 0)
      return {
        speaker: 'human',
        blocks: [
          { type: 'text', text },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'YQ==',
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            encoding: 'base64',
            data: 'JVBERg==',
            filename: 'same.pdf',
          },
        ],
        metadata: { timestamp: index },
      };
    if (index % 3 === 1)
      return {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'why',
            encryptedContent: 'same-encrypted',
          },
          { type: 'text', text },
          {
            type: 'tool_call',
            id: `call_${index}`,
            name: 'read',
            parameters: { path: 'same', missing: undefined },
          },
        ],
      };
    return {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          toolName: 'read',
          callId: `call_${index - 1}`,
          result: { text },
        },
        {
          type: 'tool_response',
          toolName: 'read',
          callId: `call_${index - 1}`,
          result: 'duplicate',
        },
        {
          type: 'media',
          mimeType: 'audio/wav',
          encoding: 'base64',
          data: 'YQ==',
        },
      ],
    };
  });
}

const pair: IContent[] = [
  {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'calling' },
      {
        type: 'tool_call',
        id: 'call_a',
        name: 'read',
        parameters: { path: '雪', ignored: undefined },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_a',
        toolName: 'read',
        result: { answer: '"\\\n😀', missing: undefined },
      },
    ],
  },
];
const media: IContent[] = [
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'media' },
      {
        type: 'media',
        mimeType: 'IMAGE/PNG',
        encoding: 'base64',
        data: 'iVBORw0KGgoAAAANSUhEUgAABjIAAAPfCAYAAAA=',
      },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'YQ==',
      },
      {
        type: 'media',
        mimeType: 'application/pdf',
        encoding: 'base64',
        data: 'JVBERi0=',
        filename: 'a".pdf',
      },
      {
        type: 'media',
        mimeType: 'audio/wav',
        encoding: 'base64',
        data: 'YQ==',
        filename: 'voice.wav',
      },
    ],
  },
];

describe('Responses disk prompt-key serializer', () => {
  it('matches the independent old oracle for empty input', async () => {
    expect(await compare([])).toBeGreaterThan(0);
  });
  it('matches tool calls and responses without retaining a pairing map', async () => {
    expect(await compare(pair)).toBeGreaterThan(0);
  });
  it('matches unicode, escaping, duplicate values and ignored metadata for 64 rich rows', async () => {
    expect(await compare(richRows())).toBeGreaterThan(0);
  });
  it('matches image dimensions, unknown images, PDF placeholders and unsupported media', async () => {
    expect(await compare(media)).toBeGreaterThan(0);
    await compare(media, { ...context, mediaPdfEnabled: false });
  });
  it('matches reasoning IDs across rows and dangling/orphan filtering', async () => {
    const rows: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'first', encryptedContent: 'encrypted' },
        ],
      },
      ...pair,
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'second',
            encryptedContent: 'encrypted',
            providerMetadata: { 'openai.responses.reasoningId': 'bogus' },
          },
          { type: 'tool_call', id: 'dangling', name: 'read', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            toolName: 'read',
            callId: 'orphan',
            result: 'drop',
          },
        ],
      },
    ];
    expect(await compare(rows)).toBeGreaterThan(0);
    await compare(rows, { ...context, serverSideParentActive: true });
  });
});

describe('Responses source ownership', () => {
  it('replays a one-shot source into two independent disk readers', async () => {
    const owner = requestScopedContents(source(pair));
    try {
      const a = owner.stream()[Symbol.asyncIterator]();
      const b = owner.stream()[Symbol.asyncIterator]();
      expect((await a.next()).value).toStrictEqual(pair[0]);
      expect((await b.next()).value).toStrictEqual(pair[0]);
      expect((await b.next()).value).toStrictEqual(pair[1]);
      expect((await a.next()).value).toStrictEqual(pair[1]);
      await a.return?.();
      await b.return?.();
      expect(owner.isMaterialized).toBe(false);
    } finally {
      await owner.dispose();
    }
    await expect(owner.stream()[Symbol.asyncIterator]().next()).rejects.toThrow(
      'disposed',
    );
  });
  it('waits for leases on close and rejects reuse after close', async () => {
    const prompt = await serializeResponsesPromptEnvelope({
      model,
      contents: source(pair),
      context,
    });
    const path = prompt.projection.promptSegments[0].source.path;
    const release = prompt.projection.acquire();
    const closing = prompt.dispose();
    expect(existsSync(path)).toBe(true);
    await release();
    await closing;
    expect(existsSync(path)).toBe(false);
    expect(() => prompt.projection.acquire()).toThrow('disposed');
    await prompt.dispose();
  });
  it('cleans disk and closes the source on abort and preserves source failure', async () => {
    const before = new Set(readdirSync(tmpdir()));
    const controller = new AbortController();
    const error = new Error('source failure');
    let closed = false;
    async function* failing(): AsyncIterable<IContent> {
      try {
        yield pair[0];
        throw error;
      } finally {
        closed = true;
      }
    }
    await expect(
      serializeResponsesPromptEnvelope({ model, contents: failing(), context }),
    ).rejects.toBe(error);
    expect(closed).toBe(true);
    controller.abort(error);
    await expect(
      serializeResponsesPromptEnvelope({
        model,
        contents: source(pair),
        context,
        signal: controller.signal,
      }),
    ).rejects.toBe(error);
    const leaked = readdirSync(tmpdir()).filter((name) => !before.has(name));
    expect(leaked).toStrictEqual([]);
  });
});

async function statefulParity(
  retainedBaselineTokens: number | undefined,
): Promise<number> {
  const request = {
    model,
    instructions,
    tools,
    input: buildOpenAIResponsesInput(pair, context),
  };
  const old = projectOpenAIResponsesPromptEnvelope(request, undefined, {
    statefulParentUsed: true,
    retainedBaselineTokens,
    incrementalRequest: request,
    fullHistoryRequest: request,
  });
  const prompt = await serializeResponsesPromptEnvelope({
    model,
    instructions,
    tools,
    contents: source(pair),
    context,
    stateful: {
      statefulParentUsed: true,
      retainedBaselineTokens,
      incrementalContents: source(pair),
      fullHistoryContents: source(pair),
    },
  });
  try {
    expect(prompt.accounting?.statefulParentUsed).toBe(true);
    if (!prompt.accounting?.incremental || !old.accounting?.incremental)
      throw new Error('Missing incremental projection');
    expect<readonly string[] | undefined>(
      texts(prompt.accounting.incremental),
    ).toStrictEqual(
      finalized(old.accounting.incremental.finalizedProjection).promptSegments,
    );
    const fullSegments =
      prompt.accounting.fullHistory === undefined
        ? undefined
        : texts(prompt.accounting.fullHistory);
    const oldFull =
      old.accounting.fullHistory === undefined
        ? undefined
        : finalized(old.accounting.fullHistory.finalizedProjection)
            .promptSegments;
    expect<readonly string[] | undefined>(fullSegments).toStrictEqual(oldFull);
    return texts(prompt.accounting.incremental).length;
  } finally {
    await prompt.dispose();
  }
}

describe('Responses stateful prompt-key policy', () => {
  it('uses input-only incremental keys with observed parent usage', async () => {
    expect(await statefulParity(123)).toBe(1);
  });
  it('uses full keys for incremental and full history without observed usage', async () => {
    expect(await statefulParity(undefined)).toBe(3);
  });
  it('rejects stateful input without observed usage or full history before consuming it', async () => {
    let pulled = false;
    async function* guarded(): AsyncIterable<IContent> {
      pulled = true;
      yield* pair;
    }
    await expect(
      serializeResponsesPromptEnvelope({
        model,
        context,
        contents: guarded(),
        stateful: { statefulParentUsed: true, incrementalContents: guarded() },
      }),
    ).rejects.toThrow('full-history');
    expect(pulled).toBe(false);
  });
});

describe('Responses serializer boundary semantics', () => {
  it('preserves genuine reasoning IDs that look like local IDs', async () => {
    const rows: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'genuine',
            encryptedContent: 'encrypted',
            providerMetadata: { 'openai.responses.reasoningId': 'rs_local_0' },
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'local', encryptedContent: 'encrypted' },
        ],
      },
    ];
    expect(await compare(rows)).toBeGreaterThan(0);
    expect(buildOpenAIResponsesInput(rows, context)).toHaveLength(2);
  });
  it('matches strings at surrogate and escape chunk boundaries and across joined blocks', async () => {
    const rows: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'x'.repeat(8191) + '😀\\\n\ud800 data:image/png;base',
          },
          { type: 'text', text: '64,YQ== trailing' },
        ],
      },
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: '' },
          { type: 'text', text: 'second' },
        ],
      },
    ];
    expect(await compare(rows)).toBeGreaterThan(0);
    expect(buildOpenAIResponsesInput(rows, context)).toHaveLength(2);
  });
  it('does not duplicate tool media for duplicate call responses and keeps URL images', async () => {
    const rows: IContent[] = [
      ...pair,
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            toolName: 'read',
            callId: 'call_a',
            result: 'again',
          },
          {
            type: 'tool_response',
            toolName: 'read',
            callId: 'call_a',
            result: 'again',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'url',
            data: 'https://example.test/image.png',
          },
        ],
      },
    ];
    expect(await compare(rows)).toBeGreaterThan(0);
    expect(buildOpenAIResponsesInput(rows, context)).toHaveLength(6);
  });
});
