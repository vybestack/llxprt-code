/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AnthropicMessageBlock } from './AnthropicMessageNormalizer.js';
import { z } from 'zod';
import {
  canonicalizePromptValue,
  type ProjectionImageEntry,
} from '../runtime/promptEnvelopeProjections.js';
import { anthropicWireMedia } from './anthropic-measured-media.js';
import {
  countO200kBaseTokensFromChunks,
  trailingO200kPiece,
  hasOversizedO200kPiece,
} from '../tokenizers/o200k-chunked-source.js';
import { getO200kBaseEncoder } from '../tokenizers/o200kBaseCounter.js';
import { extractClaudeContentFeatures } from '../tokenizers/claude/claudeContentFeatures.js';
import type { RepairPiece } from './anthropic-repair-source.js';
import { sanitizeBlockForCacheControl } from './AnthropicRequestBuilder.js';

export function canonicalAnthropicEstimateValue(
  value: unknown,
  key: string,
  observe: (image: ProjectionImageEntry) => void,
): unknown {
  if (Array.isArray(value))
    return value.map((item) =>
      canonicalAnthropicEstimateValue(item, key, observe),
    );
  if (typeof value === 'object' && value !== null) {
    const media = anthropicWireMedia(value);
    if (media === undefined && !('type' in value && value.type === 'base64'))
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          canonicalAnthropicEstimateValue(child, childKey, observe),
        ]),
      );
    const images: ProjectionImageEntry[] = [];
    const canonical = canonicalizePromptValue(value, key, images);
    for (const image of images)
      observe(
        media?.encoding === 'reference'
          ? { dimensions: media.dimensions }
          : image,
      );
    return canonical;
  }
  const images: ProjectionImageEntry[] = [];
  const canonical = canonicalizePromptValue(value, key, images);
  for (const image of images) observe(image);
  return canonical;
}

// Each opaque body starts at a fixed JSON key word. Only its final punctuation
// piece can merge with the surrounding JSON grammar, so persist its finite
// framing transitions rather than retaining source text or summing row counts.
export const ESTIMATE_SUFFIXES: readonly string[] = [
  '',
  ',{"',
  ']},{"',
  ']}]}',
  ']}],"',
  ']}]',
  ']}',
  '}',
  '}]',
  '}]}',
  '}],"',
  ']',
  '],"',
  ']}',
];
export const estimateTextFactSchema = z
  .tuple([
    z.number(),
    z.array(z.number()),
    z.number(),
    z.tuple([z.number(), z.number(), z.number(), z.number()]),
    z.boolean(),
    z.boolean(),
    z.array(z.array(z.number())),
  ])
  .transform(
    ([tokens, tails, length, features, special, oversized, images]) => ({
      tokens,
      tails,
      length,
      features: {
        codePoints: features[0],
        nonAsciiCodePoints: features[1],
        structuralCodePoints: features[2],
        whitespaceCodePoints: features[3],
      },
      special,
      oversized,
      images,
    }),
  );
export type EstimateTextFact = z.infer<typeof estimateTextFactSchema>;
export const estimatePieceFactSchema = z.object({
  string: z.boolean(),
  blank: z.boolean(),
  raw: estimateTextFactSchema.optional(),
  blocks: z.array(
    z.object({
      kind: z.string(),
      blank: z.boolean(),
      variants: z.array(estimateTextFactSchema),
    }),
  ),
});
export type EstimatePieceFact = z.infer<typeof estimatePieceFactSchema>;

const PROTOCOL_TAILS = new Set(['"}', '"}}', '}}', '}}}']);
export function encodeEstimatePieceFact(piece: EstimatePieceFact): unknown {
  const encode = (fact: EstimateTextFact): unknown => [
    fact.tokens,
    fact.tails,
    fact.length,
    [
      fact.features.codePoints,
      fact.features.nonAsciiCodePoints,
      fact.features.structuralCodePoints,
      fact.features.whitespaceCodePoints,
    ],
    fact.special,
    fact.oversized,
    fact.images,
  ];
  return {
    ...piece,
    raw: piece.raw === undefined ? undefined : encode(piece.raw),
    blocks: piece.blocks.map((block) => ({
      ...block,
      variants: block.variants.map(encode),
    })),
  };
}

const protocolTailCounts = new Map<string, Promise<number[]>>();

export async function estimateTextFact(
  value: unknown,
): Promise<EstimateTextFact> {
  const images: number[][] = [];
  const text = JSON.stringify(
    canonicalAnthropicEstimateValue(value, 'messages', (image) =>
      images.push([
        image.dimensions?.width ?? 0,
        image.dimensions?.height ?? 0,
      ]),
    ),
  );
  if (!text.startsWith('{"'))
    throw new Error('Anthropic estimate fact must start with an object key');
  const body = text.slice(2);
  const tail = trailingO200kPiece(body);
  if (!tail.endsWith('}'))
    throw new Error('Anthropic estimate fact has no closing punctuation');
  const head = body.slice(0, -tail.length);
  const encoder = await getO200kBaseEncoder();
  const count = async (part: string): Promise<number> =>
    countO200kBaseTokensFromChunks(
      (async function* () {
        yield part;
      })(),
      encoder,
    );
  const oversized = hasOversizedO200kPiece(body);
  // The chunk counter batches around oversized pieces. Measure their complete
  // framed body to preserve that counter's results at each JSON boundary.
  let tails = oversized ? undefined : protocolTailCounts.get(tail);
  if (tails === undefined) {
    tails = Promise.all(
      ESTIMATE_SUFFIXES.map((suffix) =>
        count((oversized ? body : tail) + suffix),
      ),
    );
    if (!oversized && PROTOCOL_TAILS.has(tail))
      protocolTailCounts.set(tail, tails);
  }
  return {
    tokens: oversized ? 0 : await count(head),
    tails: await tails,
    length: body.length,
    features: extractClaudeContentFeatures(body),
    special: body.includes('<|endoftext|>') || body.includes('<|endofprompt|>'),
    oversized: hasOversizedO200kPiece(body),
    images,
  };
}

export async function estimatePieceFact(
  piece: RepairPiece,
  role: 'user' | 'assistant',
): Promise<EstimatePieceFact> {
  const blocks =
    typeof piece === 'string'
      ? [
          {
            type: 'text',
            text: piece,
          } satisfies AnthropicMessageBlock,
        ]
      : piece;
  return {
    string: typeof piece === 'string',
    blank: typeof piece === 'string' && piece.trim() === '',
    raw:
      typeof piece === 'string'
        ? await estimateTextFact({ role, content: piece })
        : undefined,
    blocks: await Promise.all(
      blocks.map(async (block) => ({
        kind: block.type,
        blank: block.type === 'text' && block.text.trim() === '',
        variants: await Promise.all(
          [
            block,
            sanitizeBlockForCacheControl(block, '5m'),
            sanitizeBlockForCacheControl(block, '1h'),
          ].map(estimateTextFact),
        ),
      })),
    ),
  };
}
