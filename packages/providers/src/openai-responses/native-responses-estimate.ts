/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PromptEnvelopeAccountingProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';

import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import type { NativeResponsesPrompt } from './native-responses-body.js';
import {
  canonicalizePromptValue,
  projectOpenAIResponsesPromptEnvelope,
  type ProjectionImageEntry,
} from '../runtime/promptEnvelopeProjections.js';
import { isSanctionedOpenAIO200kModel } from '../openai/openaiModelPolicy.js';
import { countO200kBaseTokensFromChunks } from '../tokenizers/o200k-chunked-source.js';
import { getO200kBaseEncoder } from '../tokenizers/o200kBaseCounter.js';

type PromptKey = 'instructions' | 'input' | 'tools';
interface EstimateScan {
  length: number;
  special: boolean;
  carry: string;
  images: number;
}

export class NativeResponsesEstimateProjection {
  constructor(
    private readonly prompt: NativeResponsesPrompt,
    private readonly view: {
      readonly inputOnly?: boolean;
      readonly skipRows?: number;
    } = {},
  ) {}

  private keys(): readonly PromptKey[] {
    return this.view.inputOnly === true
      ? ['input']
      : ['instructions', 'input', 'tools'];
  }

  private async *segment(
    key: PromptKey,
    request: RuntimePromptEstimateRequest,
    scan: EstimateScan,
  ): AsyncGenerator<string> {
    const canonical = (value: unknown): string => {
      const images: ProjectionImageEntry[] = [];
      const normalized = canonicalizePromptValue(value, key, images);
      for (const image of images)
        scan.images += estimateImageTokens({
          provider: request.activeProvider,
          model: request.canonicalModel,
          dimensions: image.dimensions,
        });
      return typeof normalized === 'string' && key !== 'input'
        ? normalized
        : JSON.stringify(normalized);
    };
    if (key !== 'input') {
      yield canonical(this.prompt.envelope()[key]);
      return;
    }
    if (this.prompt.selection.inputOverride !== undefined) {
      yield canonical(this.prompt.selection.inputOverride.value);
      return;
    }
    yield '[';
    let separator = '';
    for await (const item of this.prompt.items(this.view.skipRows, true)) {
      yield separator;
      yield canonical(item);
      separator = ',';
    }
    yield ']';
  }

  private async *legacyPieces(
    request: RuntimePromptEstimateRequest,
    scan: EstimateScan,
  ): AsyncGenerator<string> {
    let prefix = '{';
    for (const key of this.keys()) {
      const value = this.prompt.envelope()[key];
      if (value === undefined) continue;
      yield `${prefix}${JSON.stringify(key)}:`;
      const string = key !== 'input' && typeof value === 'string';
      for await (const piece of this.segment(key, request, scan))
        yield string ? JSON.stringify(piece) : piece;
      prefix = ',';
    }
    yield '}';
  }

  private async *observe(
    pieces: AsyncIterable<string>,
    scan: EstimateScan,
  ): AsyncGenerator<string> {
    for await (const piece of pieces) {
      scan.length += piece.length;
      const window = scan.carry + piece;
      scan.special ||=
        window.includes('<|endoftext|>') || window.includes('<|endofprompt|>');
      scan.carry = window.slice(-16);
      yield piece;
    }
  }

  async estimate(
    request: RuntimePromptEstimateRequest,
    factory: RuntimeTokenizerFactory,
  ): Promise<RuntimePromptEstimateResult> {
    const exact = isSanctionedOpenAIO200kModel(request.canonicalModel);
    const scan: EstimateScan = {
      length: 0,
      special: false,
      carry: '',
      images: 0,
    };
    const encoder = await getO200kBaseEncoder();
    let count = 0;
    if (exact) {
      for (const key of this.keys()) {
        if (this.prompt.envelope()[key] !== undefined)
          count += await countO200kBaseTokensFromChunks(
            this.segment(key, request, scan),
            encoder,
          );
      }
      count += scan.images;
    } else {
      count = await countO200kBaseTokensFromChunks(
        this.observe(this.legacyPieces(request, scan), scan),
        encoder,
      );
      if (scan.special) count = Math.ceil(scan.length / 3);
    }
    const empty = projectOpenAIResponsesPromptEnvelope({
      model: request.canonicalModel,
      input: [],
    });
    const result = await factory.estimatePrompt({
      ...request,
      finalizedProjection: empty.finalizedProjection,
      legacyEstimate: () => Promise.resolve(count),
    });
    if (exact) return { ...result, count };
    if (!result.family.startsWith('legacy-'))
      throw new Error(
        `Native Responses estimator does not support ${result.family}`,
      );
    return result;
  }
}

export function nativeResponsesAccounting(
  prompt: NativeResponsesPrompt,
): PromptEnvelopeAccountingProjection | undefined {
  const stateful = prompt.selection.stateful;
  if (stateful.parentId === undefined) return undefined;
  const projection = (view: {
    readonly inputOnly?: boolean;
    readonly skipRows?: number;
  }) => ({
    finalizedProjection: new NativeResponsesEstimateProjection(prompt, view),
    legacyEstimate: (): Promise<number> =>
      Promise.reject(
        new Error('Native Responses requires the pinned estimator'),
      ),
  });
  return {
    statefulParentUsed: true,
    ...(stateful.parentRetainedTokens === undefined
      ? {
          incremental: projection({}),
          fullHistory: projection({ skipRows: 0 }),
        }
      : {
          retainedBaselineTokens: stateful.parentRetainedTokens,
          incremental: projection({ inputOnly: true }),
        }),
  };
}
