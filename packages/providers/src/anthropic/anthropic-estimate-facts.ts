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

const PROTOCOL_TAILS = new Set(['"}', '"}}', '}}', '}}}', ' "}', ' "}}']);
const PROTOCOL_HEADS = new Set(
  [...PROTOCOL_TAILS].flatMap((tail) =>
    ['5m', '1h'].map(
      (ttl) =>
        tail.slice(0, -1) +
        ',"cache_control":{"type":"ephemeral","ttl":"' +
        ttl,
    ),
  ),
);
const protocolHeadCounts = new Map<string, Promise<number>>();
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

function estimateBody(value: unknown): {
  readonly text: string;
  readonly images: number[][];
} {
  const images: number[][] = [];
  const text = JSON.stringify(
    canonicalAnthropicEstimateValue(value, 'messages', (image) =>
      images.push([
        image.dimensions?.width ?? 0,
        image.dimensions?.height ?? 0,
      ]),
    ),
  );
  return { text, images };
}

async function countText(part: string): Promise<number> {
  if (part === '') return 0;
  const cached = protocolHeadCounts.get(part);
  if (cached !== undefined) return cached;
  const encoder = await getO200kBaseEncoder();
  const count = countO200kBaseTokensFromChunks(
    (async function* () {
      yield part;
    })(),
    encoder,
  );
  if (PROTOCOL_HEADS.has(part)) protocolHeadCounts.set(part, count);
  return count;
}

export async function estimateTextFact(
  value: unknown,
): Promise<EstimateTextFact> {
  return measureTextFact(estimateBody(value));
}

async function measureTextFact(
  { text, images }: ReturnType<typeof estimateBody>,
  shared?: { readonly prefix: string; readonly tokens: number },
): Promise<EstimateTextFact> {
  if (!text.startsWith('{"'))
    throw new Error('Anthropic estimate fact must start with an object key');
  const body = text.slice(2);
  const tail = trailingO200kPiece(body);
  if (!tail.endsWith('}'))
    throw new Error('Anthropic estimate fact has no closing punctuation');
  const head = body.slice(0, -tail.length);
  const oversized = hasOversizedO200kPiece(body);
  // The chunk counter batches around oversized pieces. Measure their complete
  // framed body to preserve that counter's results at each JSON boundary.
  let tails = oversized ? undefined : protocolTailCounts.get(tail);
  if (tails === undefined) {
    tails = Promise.all(
      ESTIMATE_SUFFIXES.map((suffix) =>
        countText((oversized ? body : tail) + suffix),
      ),
    );
    if (!oversized && PROTOCOL_TAILS.has(tail))
      protocolTailCounts.set(tail, tails);
  }
  let tokens = 0;
  if (!oversized) {
    tokens =
      shared !== undefined && head.startsWith(shared.prefix)
        ? shared.tokens + (await countText(head.slice(shared.prefix.length)))
        : await countText(head);
  }
  return {
    tokens,
    tails: await tails,
    length: body.length,
    features: extractClaudeContentFeatures(body),
    special: body.includes('<|endoftext|>') || body.includes('<|endofprompt|>'),
    oversized,
    images,
  };
}

async function estimateVariants(
  block: AnthropicMessageBlock,
): Promise<EstimateTextFact[]> {
  const bodies = [
    block,
    sanitizeBlockForCacheControl(block, '5m'),
    sanitizeBlockForCacheControl(block, '1h'),
  ].map(estimateBody);
  let prefix = bodies[0].text.slice(2);
  for (const { text } of bodies.slice(1)) {
    let at = 0;
    while (at < prefix.length && prefix[at] === text[at + 2]) at++;
    prefix = prefix.slice(0, at);
  }
  // Discard the possibly incomplete final pre-tokenizer piece. The remaining
  // prefix ends on a shared piece boundary in all three serialized variants.
  prefix = prefix.slice(0, -trailingO200kPiece(prefix).length);
  const shared = hasOversizedO200kPiece(prefix)
    ? undefined
    : { prefix, tokens: await countText(prefix) };
  return Promise.all(bodies.map((body) => measureTextFact(body, shared)));
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
        variants: await estimateVariants(block),
      })),
    ),
  };
}
