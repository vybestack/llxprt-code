/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ProjectionImageEntry } from '../runtime/promptEnvelopeProjections.js';
import {
  ESTIMATE_SUFFIXES,
  type EstimateTextFact,
} from './anthropic-estimate-facts.js';
import { countO200kBaseTokensFromChunks } from '../tokenizers/o200k-chunked-source.js';
import type { O200kBaseEncoder } from '../tokenizers/o200kBaseCounter.js';
import {
  addClaudeContentFeatures,
  type ClaudeContentFeatureExtractor,
} from '../tokenizers/claude/claudeContentFeatures.js';

class NumericTokens {
  private pending: EstimateTextFact | undefined;
  framing = '';
  tokens = 0;
  constructor(
    private readonly encoder: O200kBaseEncoder,
    private readonly signal?: AbortSignal,
  ) {}
  private count(text: string): Promise<number> {
    return countO200kBaseTokensFromChunks(
      (async function* () {
        yield text;
      })(),
      this.encoder,
      this.signal,
    );
  }
  async flush(): Promise<void> {
    if (this.pending === undefined)
      this.tokens += await this.count(this.framing);
    else {
      const punctuation = /^[^\p{L}\p{N}\s]+/u.exec(this.framing)?.[0] ?? '';
      const at = ESTIMATE_SUFFIXES.indexOf(punctuation);
      if (at < 0)
        throw new Error(
          `Unsupported Anthropic estimate framing ${JSON.stringify(punctuation)}`,
        );
      this.tokens +=
        this.pending.tokens +
        this.pending.tails[at] +
        (await this.count(this.framing.slice(punctuation.length)));
    }
    this.framing = '';
  }
  async fact(piece: EstimateTextFact): Promise<void> {
    await this.flush();
    this.pending = piece;
  }
}
export async function measureAnthropicPieces(
  pieces: AsyncIterable<string | EstimateTextFact>,
  encoder: O200kBaseEncoder,
  extractFeatures: ClaudeContentFeatureExtractor,
  numeric: boolean,
  observeImage: (image: ProjectionImageEntry) => void,
  signal?: AbortSignal,
): Promise<{
  baseTokens: number;
  features: ReturnType<ClaudeContentFeatureExtractor>;
  special: boolean;
  length: number;
}> {
  let features = extractFeatures('');
  let length = 0;
  let special = false;
  let carry = '';
  const counter = new NumericTokens(encoder, signal);
  const observe = async function* (): AsyncGenerator<string> {
    for await (const piece of pieces) {
      signal?.throwIfAborted();
      if (typeof piece === 'string') {
        features = addClaudeContentFeatures(features, extractFeatures(piece));
        length += piece.length;
        const window = carry + piece;
        special ||=
          window.includes('<|endoftext|>') ||
          window.includes('<|endofprompt|>');
        carry = window.slice(-16);
        if (numeric) counter.framing += piece;
        else yield piece;
      } else {
        if (!numeric)
          throw new Error('Unexpected numeric fact in streaming estimate');
        await counter.fact(piece);
        features = addClaudeContentFeatures(features, piece.features);
        length += piece.length;
        special ||= piece.special;
        carry = '';
        for (const image of piece.images)
          observeImage({
            dimensions:
              image[0] === 0
                ? undefined
                : { width: image[0], height: image[1] },
          });
      }
    }
  };
  const streamed = await countO200kBaseTokensFromChunks(
    observe(),
    encoder,
    signal,
  );
  if (numeric) await counter.flush();
  return {
    baseTokens: numeric ? counter.tokens : streamed,
    features,
    length,
    special,
  };
}
