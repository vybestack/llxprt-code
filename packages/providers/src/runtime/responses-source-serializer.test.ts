/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from '../openai-responses/OpenAIResponsesInputBuilder.js';
import {
  nativePrompt,
  nativeRows,
  nativePromptKeys,
  nativeImages,
} from './__tests__/native-responses-fixture.js';
import type { NativeResponsesPrompt } from '../openai-responses/native-responses-body.js';
import { nativeResponsesAccounting } from '../openai-responses/native-responses-estimate.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { requestScopedContents } from '../utils/requestScopedBody.js';
import { collectUnsupportedMedia } from '../utils/mediaUtils.js';
import { SyntheticToolResponseHandler } from '../openai/syntheticToolResponses.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const context: ResponsesInputBuildContext = {
  includeReasoningInContext: true,
  outputLimits: parseOutputLimits({}),
  debug: () => {},
  mediaPdfEnabled: true,
  // The oracle and the source route must stamp synthesized reasoning ids with
  // the same request time to be byte-comparable.
  reasoningIdTime: 1700000000000,
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
  const prompt = await nativePrompt(
    nativeRows(SyntheticToolResponseHandler.patchMessageHistory(rows)),
    {
      model,
      instructions,
      tools,
      context: buildContext,
    },
  );
  try {
    expect<readonly string[] | undefined>(
      await nativePromptKeys(prompt),
    ).toStrictEqual(old.promptSegments);
    expect(prompt.model).toBe(oracle.model);
    expect(prompt.projectionRevision).toBe(oracle.projectionRevision);
    const costs = (await nativeImages(prompt)).map((entry) => ({
      cost: estimateImageTokens({
        provider: 'openai-responses',
        model,
        dimensions: entry.dimensions,
      }),
      ...(entry.dimensions === undefined
        ? {}
        : { dimensions: entry.dimensions }),
    }));
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
    expect(costs).toStrictEqual(expected);
    expect((await nativeImages(prompt)).length).toBe(expected.length);
    const nativeText = (await nativePromptKeys(prompt)).join('');
    for (const entry of oracle.unsupportedMedia)
      expect(nativeText).toContain(
        entry.mediaType === 'application/pdf'
          ? 'PDF input is disabled'
          : (entry.mediaType ?? entry.reason),
      );
    expect((await nativePromptKeys(prompt))[1]).toBe(old.promptSegments[1]);
    expect(
      Object.getOwnPropertyDescriptor(prompt, 'imageEntries'),
    ).toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(
        prompt.toEstimatorProjection(),
        'promptText',
      ),
    ).toBeUndefined();
    return Buffer.byteLength((await nativePromptKeys(prompt))[1]);
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
    } finally {
      await owner.dispose();
    }
    await expect(owner.stream()[Symbol.asyncIterator]().next()).rejects.toThrow(
      'disposed',
    );
  });
  it('rejects native projection reads after close and allows repeated disposal', async () => {
    const prompt = await nativePrompt(nativeRows(pair), { model, context });
    await prompt.dispose();
    await expect(nativePromptKeys(prompt)).rejects.toThrow('closed');
    expect(() => prompt.toEstimatorProjection()).toThrow('closed');
    await prompt.dispose();
  });
  it('preserves row-source failure and abort without scratch residue', async () => {
    const before = new Set(readdirSync(getScratchRoot()));
    const controller = new AbortController();
    const error = new Error('source failure');
    let closed = false;
    const rows = {
      ...nativeRows(pair),
      async *openReader() {
        try {
          yield pair[0];
          throw error;
        } finally {
          closed = true;
        }
      },
    };
    await expect(nativePrompt(rows, { model, context })).rejects.toBe(error);
    expect(closed).toBe(true);
    controller.abort(error);
    await expect(
      nativePrompt(nativeRows(pair), {
        model,
        context,
        signal: controller.signal,
      }),
    ).rejects.toBe(error);
    expect(
      readdirSync(getScratchRoot()).filter((name) => !before.has(name)),
    ).toStrictEqual([]);
  });
});

async function statefulParity(
  retainedBaselineTokens: number | undefined,
): Promise<NonNullable<ReturnType<typeof nativeResponsesAccounting>>> {
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
  const prompt: NativeResponsesPrompt = await nativePrompt(nativeRows(pair), {
    model,
    instructions,
    tools,
    context,
    selection: {
      skipRows: 0,
      stateful: {
        enabled: true,
        parentId: 'parent',
        parentRetainedTokens: retainedBaselineTokens,
      },
    },
  });
  try {
    const accounting = nativeResponsesAccounting(prompt);
    if (accounting === undefined) throw new Error('Missing native accounting');
    expect(accounting.statefulParentUsed).toBe(true);
    const factory = createRuntimeTokenizerFactory();
    const actual = {
      ...old,
      finalizedProjection: prompt.toEstimatorProjection(),
      accounting,
    };
    expect(
      await estimatePromptEnvelope('openai-responses', actual, factory),
    ).toStrictEqual(
      await estimatePromptEnvelope('openai-responses', old, factory),
    );
    expect(accounting.retainedBaselineTokens).toBe(retainedBaselineTokens);
    expect(accounting.fullHistory !== undefined).toBe(
      retainedBaselineTokens === undefined,
    );
    expect(accounting.incremental).toBeDefined();
    return accounting;
  } finally {
    await prompt.dispose();
  }
}

describe('Responses native stateful prompt-key policy', () => {
  it('uses input-only incremental keys with observed parent usage', async () => {
    expect(await statefulParity(123)).toMatchObject({
      statefulParentUsed: true,
      retainedBaselineTokens: 123,
    });
  });
  it('uses full keys for incremental and full history without observed usage', async () => {
    expect(await statefulParity(undefined)).toHaveProperty('fullHistory');
  });
  it('rejects an unadmitted stateful source before consuming it', async () => {
    let pulled = false;
    const rows = {
      ...nativeRows(pair),
      callerOwned: undefined,
      async *openReader(): AsyncGenerator<IContent> {
        pulled = true;
        yield* pair;
      },
    };
    await expect(
      nativePrompt(rows, {
        model,
        context,
        selection: {
          skipRows: 0,
          stateful: { enabled: true, parentId: 'parent' },
        },
      }),
    ).rejects.toThrow('native request rows');
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
