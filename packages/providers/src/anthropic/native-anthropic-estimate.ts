/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { ProjectionImageEntry } from '../runtime/promptEnvelopeProjections.js';
import {
  canonicalAnthropicEstimateValue as canonicalMediaValue,
  type EstimateTextFact,
} from './anthropic-estimate-facts.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { measureAnthropicPieces } from './anthropic-estimate-counter.js';
import {
  getO200kBaseEncoder,
  type O200kBaseEncoder,
} from '../tokenizers/o200kBaseCounter.js';
import {
  extractClaudeContentFeatures,
  type ClaudeContentFeatureExtractor,
  type ClaudeContentFeatures,
} from '../tokenizers/claude/claudeContentFeatures.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
import type { AnthropicCachePlan } from './anthropic-cache-facts.js';

export class NativeAnthropicEstimateProjection {
  readonly protocol = 'anthropic-messages';
  private closed = false;
  constructor(
    private readonly engine: Pick<AnthropicStreamRepair, 'serialize'>,
    private readonly envelope: Readonly<Record<string, unknown>>,
    readonly signal?: AbortSignal,
    private readonly prefix?: AnthropicMessage,
    private readonly cache?: AnthropicCachePlan,
  ) {}

  private async *pieces(
    observeImage: (image: ProjectionImageEntry) => void,
  ): AsyncGenerator<string | EstimateTextFact> {
    this.requireOpen();
    let separator = '{';
    for (const key of ['system', 'messages', 'tools']) {
      const value = this.envelope[key];
      if (value === undefined) continue;
      yield `${separator}${JSON.stringify(key)}:`;
      const canonical = (item: unknown): unknown =>
        canonicalMediaValue(item, key, observeImage);
      if (key === 'messages') {
        if (
          this.engine instanceof AnthropicStreamRepair &&
          this.engine.source.query instanceof IndexedJournalRequestSnapshot &&
          this.engine.source.query.viewPlan.changedSources.length === 0
        )
          yield* await this.engine.numericEstimatePieces(
            this.prefix,
            this.cache,
          );
        else yield* this.engine.serialize(canonical, this.prefix, this.cache);
      } else yield JSON.stringify(canonical(value));
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
    const numeric =
      this.engine instanceof AnthropicStreamRepair &&
      this.engine.source.query instanceof IndexedJournalRequestSnapshot &&
      this.engine.source.query.viewPlan.changedSources.length === 0;
    const measured = await measureAnthropicPieces(
      this.pieces(observeImage),
      encoder,
      extractFeatures,
      numeric,
      observeImage,
      this.signal,
    );
    this.requireOpen();
    return { ...measured, imageTokens };
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
