/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import {
  canonicalizePromptValue,
  type ProjectionImageEntry,
} from '../runtime/promptEnvelopeProjections.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { countO200kBaseTokensFromChunks } from '../tokenizers/o200k-chunked-source.js';
import {
  getO200kBaseEncoder,
  type O200kBaseEncoder,
} from '../tokenizers/o200kBaseCounter.js';
import {
  addClaudeContentFeatures,
  extractClaudeContentFeatures,
  type ClaudeContentFeatureExtractor,
  type ClaudeContentFeatures,
} from '../tokenizers/claude/claudeContentFeatures.js';
import type { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
import type { AnthropicCachePlan } from './anthropic-cache-facts.js';
import { anthropicWireMedia } from './anthropic-measured-media.js';

function canonicalMediaValue(
  value: unknown,
  key: string,
  observe: (image: ProjectionImageEntry) => void,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => canonicalMediaValue(item, key, observe));
  if (typeof value === 'object' && value !== null) {
    const media = anthropicWireMedia(value);
    if (media === undefined && !('type' in value && value.type === 'base64'))
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          canonicalMediaValue(child, childKey, observe),
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

export class NativeAnthropicEstimateProjection {
  readonly protocol = 'anthropic-messages';
  private closed = false;
  constructor(
    private readonly engine: AnthropicStreamRepair,
    private readonly envelope: Readonly<Record<string, unknown>>,
    readonly signal?: AbortSignal,
    private readonly prefix?: AnthropicMessage,
    private readonly cache?: AnthropicCachePlan,
  ) {}

  private async *pieces(
    observeImage: (image: ProjectionImageEntry) => void,
  ): AsyncGenerator<string> {
    this.requireOpen();
    let separator = '{';
    for (const key of ['system', 'messages', 'tools']) {
      const value = this.envelope[key];
      if (value === undefined) continue;
      yield `${separator}${JSON.stringify(key)}:`;
      const canonical = (item: unknown): unknown =>
        canonicalMediaValue(item, key, observeImage);
      if (key === 'messages')
        yield* this.engine.serialize(canonical, this.prefix, this.cache);
      else yield JSON.stringify(canonical(value));
      separator = ',';
    }
    yield '}';
  }

  async measure(
    request: RuntimePromptEstimateRequest,
    encoder: O200kBaseEncoder,
    extractFeatures: ClaudeContentFeatureExtractor = extractClaudeContentFeatures,
  ): Promise<{
    baseTokens: number;
    features: ClaudeContentFeatures;
    imageTokens: number;
    special: boolean;
    length: number;
  }> {
    let imageTokens = 0;
    const observeImage = (image: ProjectionImageEntry): void => {
      imageTokens += estimateImageTokens({
        provider: request.activeProvider,
        model: request.canonicalModel,
        dimensions: image.dimensions,
      });
    };
    let features = extractFeatures('');
    let carry = '';
    let special = false;
    let length = 0;
    const observe = async function* (
      pieces: AsyncIterable<string>,
    ): AsyncGenerator<string> {
      for await (const piece of pieces) {
        features = addClaudeContentFeatures(features, extractFeatures(piece));
        length += piece.length;
        const window = carry + piece;
        special ||=
          window.includes('<|endoftext|>') ||
          window.includes('<|endofprompt|>');
        carry = window.slice(-16);
        yield piece;
      }
    };
    const baseTokens = await countO200kBaseTokensFromChunks(
      observe(this.pieces(observeImage)),
      encoder,
      this.signal,
    );
    this.requireOpen();
    return {
      baseTokens,
      features,
      special,
      length,
      imageTokens,
    };
  }

  estimate(
    request: RuntimePromptEstimateRequest,
    factory: RuntimeTokenizerFactory,
  ): Promise<RuntimePromptEstimateResult> {
    this.requireOpen();
    return factory.estimatePrompt({
      ...request,
      finalizedProjection: this,
      legacyEstimate: async () => {
        const measured = await this.measure(
          request,
          await getO200kBaseEncoder(),
        );
        return measured.special
          ? Math.ceil(measured.length / 3)
          : measured.baseTokens;
      },
    });
  }

  private requireOpen(): void {
    this.signal?.throwIfAborted();
    if (this.closed) throw new Error('Native Anthropic estimate is closed');
  }
  dispose(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
