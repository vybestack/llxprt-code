/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 step B5: estimator parity between the segment-file path and the
 * whole-body path for OpenAI chat and Anthropic.
 *
 * The whole-body path is what runs today: project the finished request body to
 * a finalized string projection, then count it with the GPT-5.6 estimator. The
 * segment-file path writes the same prompt-bearing keys as estimator-form
 * files and counts them from disk. Bodies come from the real history
 * converters over the golden corpus histories, so the corpus exercises tool
 * pairing, thinking, media and Unicode edge cases. If any case differs, the
 * estimator input text changed and PROJECTION_REVISION needs a bump.
 */
import { describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { convertToAnthropicMessages } from '../anthropic/AnthropicMessageNormalizer.js';
import { buildMessagesWithReasoning } from '../openai/OpenAIRequestBuilder.js';
import { estimateGpt56Prompt } from '../tokenizers/Gpt56O200kPromptEstimator.js';
import { estimateGpt56PromptFromSources } from '../tokenizers/gpt56-source-prompt-estimator.js';
import type { Gpt56SourceProjection } from '../tokenizers/gpt56-source-projection.js';
import { promptTextPieces } from '../tokenizers/source-family-input.js';
import {
  buildHistoryCases,
  type HistoryCase,
} from '../__tests__/support/wireBodyHistories.js';
import {
  projectAnthropicPromptEnvelope,
  projectOpenAIChatPromptEnvelope,
  type ProviderFinalizedPromptProjection,
} from './promptEnvelopeProjections.js';
import { projectBodyFromSegments } from './__tests__/support/promptBodySegments.js';

type Protocol = 'openai-chat' | 'anthropic-messages';
type Body = Readonly<Record<string, unknown>>;

const MODEL = 'gpt-5.6-sol';
const ACTIVE_PROVIDER: Record<Protocol, string> = {
  'openai-chat': 'openai',
  'anthropic-messages': 'anthropic',
};
const unusedReference: MediaReferenceBlock = {
  type: 'media_reference',
} as unknown as MediaReferenceBlock;

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

function imageRow(...sizes: ReadonlyArray<[number, number]>): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'look at these' },
      ...sizes.map(([width, height]) => ({
        type: 'media' as const,
        mimeType: 'image/png',
        encoding: 'base64' as const,
        data: png(width, height),
      })),
    ],
  };
}

/** Cases the golden corpus lacks: header-bearing images and embedded data URIs. */
function extraCases(): HistoryCase[] {
  const dataUri = `data:image/png;base64,${png(40, 41)}`;
  return [
    {
      id: 'many-images',
      description: 'three images of different sizes in two rows',
      rows: [
        imageRow([1586, 991], [32, 32]),
        { speaker: 'ai', blocks: [{ type: 'text', text: 'seen' }] },
        imageRow([4096, 4096]),
        { speaker: 'ai', blocks: [{ type: 'text', text: 'also seen' }] },
        { speaker: 'human', blocks: [{ type: 'text', text: 'ok' }] },
      ],
      systemInstruction: 'Describe images.',
    },
    {
      id: 'embedded-data-uri',
      description: 'data URIs inside text, a tool result and the system prompt',
      rows: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: `inline ${dataUri} then more 雪` }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'uri_call',
              name: 'read_file',
              parameters: { path: '/img.png', uri: dataUri },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'uri_call',
              toolName: 'read_file',
              result: `body ${dataUri}`,
            },
          ],
        },
        { speaker: 'human', blocks: [{ type: 'text', text: 'done' }] },
      ],
      systemInstruction: `System ${dataUri} end`,
    },
  ];
}

function corpus(): HistoryCase[] {
  return [
    ...buildHistoryCases({ imageReference: unusedReference })
      // Media references need the request media store; the converters take
      // resolved rows, so those cases are not meaningful here.
      .filter((entry) => entry.usesMediaReferences !== true),
    ...extraCases(),
  ];
}

function chatBody(entry: HistoryCase): Body {
  const converted = buildMessagesWithReasoning(
    [...entry.rows],
    {
      invocation: {
        ephemerals: {
          'reasoning.includeInContext': true,
          'reasoning.stripFromContext': 'none',
        },
      },
    },
    undefined,
    undefined,
  );
  return {
    model: 'gpt-4o',
    messages:
      entry.systemInstruction === undefined
        ? converted
        : [{ role: 'system', content: entry.systemInstruction }, ...converted],
    stream: true,
    tools: entry.tools?.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parametersJsonSchema,
      },
    })),
  };
}

function anthropicBodies(entry: HistoryCase): Array<[string, Body]> {
  const messages = convertToAnthropicMessages([...entry.rows], {
    isOAuth: false,
    includeInContext: true,
    stripFromContext: 'none',
    reasoningEnabled: true,
    config: undefined,
    currentModel: 'claude-opus-5',
    unprefixToolName: (name) => name,
    logger: { debug: () => {} },
  });
  const base = {
    model: 'claude-opus-5',
    messages,
    max_tokens: 1024,
    stream: true,
    tools: entry.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parametersJsonSchema,
    })),
  };
  if (entry.systemInstruction === undefined) return [['no-system', base]];
  return [
    ['system-string', { ...base, system: entry.systemInstruction }],
    [
      'system-blocks',
      {
        ...base,
        system: [
          {
            type: 'text',
            text: entry.systemInstruction,
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ],
  ];
}

function bodiesFor(protocol: Protocol, entry: HistoryCase) {
  return protocol === 'openai-chat'
    ? ([['messages', chatBody(entry)]] as Array<[string, Body]>)
    : anthropicBodies(entry);
}

function isFinalizedProjection(
  value: unknown,
): value is ProviderFinalizedPromptProjection {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'promptText' in value &&
    typeof value.promptText === 'string' &&
    'promptSegments' in value &&
    Array.isArray(value.promptSegments)
  );
}

function legacyProjection(
  protocol: Protocol,
  body: Body,
): ProviderFinalizedPromptProjection {
  const projection =
    protocol === 'openai-chat'
      ? projectOpenAIChatPromptEnvelope(body)
      : projectAnthropicPromptEnvelope(body);
  const finalized = projection.finalizedProjection;
  if (!isFinalizedProjection(finalized))
    throw new Error('Legacy projection has no prompt segments');
  return finalized;
}

function request(
  protocol: Protocol,
  finalizedProjection: unknown,
): RuntimePromptEstimateRequest {
  return {
    activeProvider: ACTIVE_PROVIDER[protocol],
    canonicalModel: MODEL,
    protocol,
    wireMethod:
      protocol === 'openai-chat' ? 'chat/completions/v1' : 'messages/v1',
    finalizedProjection,
    projectionRevision: 4,
    legacyEstimate: () => Promise.reject(new Error('No fallback')),
  };
}

async function textOf(projection: Gpt56SourceProjection): Promise<string> {
  let text = '';
  for await (const piece of promptTextPieces(projection)) text += piece;
  return text;
}

function segmentBytes(projection: Gpt56SourceProjection): Buffer[] {
  return projection.promptSegments.map((segment) =>
    readFileSync(segment.source.path),
  );
}

function legacyBytes(
  legacy: ProviderFinalizedPromptProjection,
  projection: Gpt56SourceProjection,
): Buffer[] {
  const segments = legacy.promptSegments ?? [];
  return segments.map((text, index) =>
    Buffer.from(
      text,
      projection.promptSegments[index]?.rawString === true ? 'utf16le' : 'utf8',
    ),
  );
}

interface Outcome {
  readonly count: number;
  readonly images: number;
}

async function countBothWays(protocol: Protocol, body: Body): Promise<Outcome> {
  const legacy = legacyProjection(protocol, body);
  const expected = await estimateGpt56Prompt(request(protocol, legacy));
  const workspaceDirectory = mkdtempSync(join(tmpdir(), 'segment-parity-'));
  const projection = await projectBodyFromSegments(protocol, body, MODEL);
  try {
    expect(projection.protocol).toBe(protocol);
    expect(segmentBytes(projection)).toStrictEqual(
      legacyBytes(legacy, projection),
    );
    expect(await textOf(projection)).toBe(legacy.promptText);
    const actual = await estimateGpt56PromptFromSources(
      request(protocol, projection),
      { workspaceDirectory },
    );
    expect(actual).toStrictEqual(expected);
    expect(readdirSync(workspaceDirectory)).toStrictEqual([]);
    return { count: actual.count, images: legacy.imageEntries?.length ?? 0 };
  } finally {
    await projection.dispose();
    rmSync(workspaceDirectory, { recursive: true, force: true });
  }
}

describe.each([['openai-chat'], ['anthropic-messages']] as const)(
  'estimator parity for %s: segment files equal the whole body',
  (protocol) => {
    for (const entry of corpus()) {
      for (const [label, body] of bodiesFor(protocol, entry)) {
        it(`${entry.id} (${label}) counts the same`, async () => {
          const outcome = await countBothWays(protocol, body);
          expect(outcome.count).toBeGreaterThan(0);
        });
      }
    }

    it('counts every image on the image cases', async () => {
      const entry = extraCases()[0];
      for (const [, body] of bodiesFor(protocol, entry)) {
        const outcome = await countBothWays(protocol, body);
        expect(outcome.images).toBe(3);
      }
    });

    it('detects a segment file that differs from the whole body', async () => {
      const entry = corpus().find((candidate) => candidate.id === 'text-only');
      if (entry === undefined) throw new Error('text-only case is missing');
      const [[, body]] = bodiesFor(protocol, entry);
      const legacy = legacyProjection(protocol, body);
      const expected = await estimateGpt56Prompt(request(protocol, legacy));
      const workspaceDirectory = mkdtempSync(join(tmpdir(), 'segment-trap-'));
      const projection = await projectBodyFromSegments(protocol, body, MODEL);
      try {
        const messages = projection.promptSegments.find(
          (segment) => segment.promptKey === 'messages',
        );
        if (messages === undefined) throw new Error('messages segment missing');
        appendFileSync(messages.source.path, ' an extra sentence of tokens');
        const actual = await estimateGpt56PromptFromSources(
          request(protocol, projection),
          { workspaceDirectory },
        );
        expect(actual.count).toBeGreaterThan(expected.count);
      } finally {
        await projection.dispose();
        rmSync(workspaceDirectory, { recursive: true, force: true });
      }
    });
  },
);
